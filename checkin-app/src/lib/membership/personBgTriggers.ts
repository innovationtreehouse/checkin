import prisma from "@/lib/prisma";
import { bgFreshThreshold, personBgVerdict } from "@/lib/membership/personBgCheck";
import { nextBoundary } from "@/lib/membership/renewal";
import { LIVE_PERSON } from "@/lib/person/filters";

/**
 * Triggers that OPEN a per-person background-check obligation (PERSON_BG process,
 * Phase 2 — warn-only). Two triggers, both keyed on the SAME "who needs a check"
 * rule as the compliance dashboard: personBgVerdict === "NEEDED" over the
 * program-attached population (ProgramParticipant ∪ ProgramVolunteer ∪
 * Program.leadMentor). Deliberately NOT triggered by role-assignment: age is
 * judged as-of a boundary, so someone who turns 18 mid-year is caught at the next
 * annual run, not when they take a role.
 */

const SYSTEM_ACTOR = 0;

/** Person is attached to at least one program in any of the three roles. */
const PROGRAM_ATTACHED_WHERE = {
    OR: [
        { programParticipants: { some: {} } },
        { programVolunteers: { some: {} } },
        { programsLed: { some: {} } },
    ],
};

/**
 * Open one PERSON_BG obligation for `personId`, evaluated as of `asOf` (the annual
 * boundary for the cron, activation time for a new join; `threshold` is
 * bgFreshThreshold(asOf, bgRecheckMonths)). Idempotent + concurrency-safe: a FOR
 * UPDATE lock on the Person row serializes the check-then-insert (mirrors
 * createRenewalProcess in renewal.ts), so the daily cron and a near-cutoff
 * activation can't both open one.
 *
 * Dedup guards: (b) opens nothing unless personBgVerdict === "NEEDED" — which
 * already encodes "≥18 as of asOf AND not fresh" (FRESH/MINOR/DOB_MISSING all
 * skip); (a) opens nothing if a PERSON_BG is already in flight or blocked for this
 * person (BLOCKED is a manual-followup item, not something to auto-reopen nightly).
 * Returns the created process, or null when skipped.
 */
export async function openPersonBg(personId: number, asOf: Date, threshold: Date) {
    return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Person" WHERE id = ${personId} FOR UPDATE`;
        const person = await tx.person.findUnique({
            where: { id: personId },
            select: { dateOfBirth: true, isDeclaredAdult: true, lastBackgroundCheck: true },
        });
        if (!person) return null;
        if (personBgVerdict(person, asOf, threshold) !== "NEEDED") return null; // (b)
        // Left literal on purpose (#1080): this is NOT a transition from-state — the
        // PERSON_BG edge is ∅→PENDING_BG_REVIEW (no from-row). This `{in:…}` is an
        // idempotency EXISTENCE set ("a PERSON_BG is already open or blocked for this
        // person → skip"), broader than any single from-state, so it can't be sourced
        // from `fromWhere` without misrepresenting it.
        const existing = await tx.orgMembershipProcess.findFirst({
            where: { kind: "PERSON_BG", subjectPersonId: personId, status: { in: ["PENDING_BG_REVIEW", "BLOCKED"] } },
            select: { id: true },
        });
        if (existing) return null; // (a)
        const created = await tx.orgMembershipProcess.create({
            data: { kind: "PERSON_BG", subjectPersonId: personId, orgMembershipId: null, status: "PENDING_BG_REVIEW" },
        });
        await tx.auditLog.create({
            data: {
                actorId: SYSTEM_ACTOR,
                action: "CREATE",
                tableName: "OrgMembershipProcess",
                affectedEntityId: created.id,
                newData: { kind: "PERSON_BG", status: "PENDING_BG_REVIEW", subjectPersonId: personId },
            },
        });
        return created;
    });
}

/**
 * Trigger A — annual cohort. For every program-attached person NEEDED as of the
 * membership-year boundary, open a PERSON_BG. Idempotent: re-running opens none
 * (dedup guard), so the cron is safe to run daily. Skips entirely when the board
 * hasn't set bgRecheckMonths (policy unset) or has no membership-year boundary.
 */
export async function runPersonBgAnnualSweep(now: Date) {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const months = settings?.bgRecheckMonths ?? 0;
    if (months <= 0) return { opened: 0, reason: "bgRecheckMonths not configured" };
    if (!settings?.orgMembershipYearBoundary) return { opened: 0, reason: "no membership-year boundary configured" };

    const boundary = nextBoundary(settings.orgMembershipYearBoundary, now);
    const threshold = bgFreshThreshold(boundary, months);
    const people = await prisma.person.findMany({ where: { ...PROGRAM_ATTACHED_WHERE, ...LIVE_PERSON }, select: { id: true } });

    let opened = 0;
    for (const p of people) {
        const created = await openPersonBg(p.id, boundary, threshold);
        if (created) opened++;
    }
    return { opened, boundary: boundary.toISOString() };
}

/**
 * Trigger C — new-member activation. When a brand-new membership (INITIAL) first
 * goes ACTIVE, open a PERSON_BG for each program-attached person in that household
 * who is ≥18 as of activation and not fresh. Age is judged as-of `asOf` (join),
 * NOT the annual boundary — this is what catches a just-turned-18 joiner the
 * boundary run would still classify as a minor. Household leads freshly stamped by
 * the INITIAL check are skipped by the dedup guard. Population is program-attached
 * only — the same set as Trigger A / the dashboard (one source of "who needs a
 * check"). No-op when bgRecheckMonths is unset.
 */
export async function openPersonBgForNewMember(householdId: number, asOf: Date) {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const months = settings?.bgRecheckMonths ?? 0;
    if (months <= 0) return;
    const threshold = bgFreshThreshold(asOf, months);
    const people = await prisma.person.findMany({
        where: { householdId, ...PROGRAM_ATTACHED_WHERE, ...LIVE_PERSON },
        select: { id: true },
    });
    for (const p of people) await openPersonBg(p.id, asOf, threshold);
}
