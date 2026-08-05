import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { householdBgIsFresh, nextBoundary } from "@/lib/membership/renewal";
import { bgFreshThreshold, personBgVerdict } from "@/lib/membership/personBgCheck";
import { agreementCycleFloor } from "@/lib/membership/personAgreementTriggers";
import { LIVE_PERSON, PROGRAM_ATTACHED_WHERE } from "@/lib/person/filters";

export const dynamic = "force-dynamic";

/**
 * Board-only, PULL-ONLY membership compliance dashboard: households that have
 * fallen out of compliance but were NOT auto-terminated (the system deliberately
 * never auto-revokes — a human must follow up). Surfaces only what's knowable
 * from real data; there is no GRACE status modeled, so no grace bucket. Reasons:
 *   STALE_BG  — ACTIVE household whose background check aged past bgRecheckMonths
 *               (predicate owned by householdBgIsFresh; skipped when the board
 *               hasn't set the policy, i.e. bgRecheckMonths = 0).
 *   REVOKED / DENIED — OrgMembership status.
 *   STUCK_BG_CLEARANCE — a process parked at PENDING_BG_CLEARANCE (paid, never cleared).
 * A household with multiple problems gets all its reason tags.
 *
 * Also returns two PERSON-scoped lists (program people may not sit in a member
 * household, so they can't key on householdId):
 *   peopleNeedingBgCheck — program-attached people ≥18 (as of the boundary) with
 *                          no fresh check. Skipped when bgRecheckMonths = 0.
 *   peopleMissingDob     — program-attached people whose age is unknown (no DOB,
 *                          not declared 25+): data hygiene, NOT bg-needed.
 */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const bgRecheckMonths = settings?.bgRecheckMonths ?? 0;
    const boundary = settings?.orgMembershipYearBoundary
        ? nextBoundary(settings.orgMembershipYearBoundary, new Date())
        : new Date();

    // householdId -> Set<reason>
    const reasons = new Map<number, Set<string>>();
    const add = (householdId: number, reason: string) => {
        const set = reasons.get(householdId) ?? new Set<string>();
        set.add(reason);
        reasons.set(householdId, set);
    };

    // 1. Stale background check — only when the board has configured a window.
    //    Reuse householdBgIsFresh per household (stale = returns false); when
    //    bgRecheckMonths = 0 it always returns false, so skip the whole bucket.
    if (bgRecheckMonths > 0) {
        const active = await prisma.orgMembership.findMany({
            where: { status: "ACTIVE" },
            select: { householdId: true },
        });
        for (const m of active) {
            const fresh = await householdBgIsFresh(m.householdId, boundary, bgRecheckMonths);
            if (!fresh) add(m.householdId, "STALE_BG");
        }
    }

    // 2. REVOKED / DENIED memberships — tag which.
    const revokedDenied = await prisma.orgMembership.findMany({
        where: { status: { in: ["REVOKED", "DENIED"] } },
        select: { householdId: true, status: true },
    });
    for (const m of revokedDenied) add(m.householdId, m.status);

    // 3. Stuck at BG clearance — paid but never cleared.
    const stuck = await prisma.orgMembershipProcess.findMany({
        where: { status: "PENDING_BG_CLEARANCE" },
        select: { orgMembership: { select: { householdId: true } } },
    });
    // PENDING_BG_CLEARANCE is a household-process status; orgMembership is always set.
    for (const p of stuck) if (p.orgMembership) add(p.orgMembership.householdId, "STUCK_BG_CLEARANCE");

    // 4. Program-attached people ≥18 without a fresh background check (warn-only).
    //    Subject = union of ProgramParticipant / ProgramVolunteer / Program.leadMentor.
    //    A program lead/volunteer may sit in a household that isn't a member household,
    //    so these are person-scoped, NOT folded into the householdId reason map above.
    //    Skip the whole bucket when the board hasn't set a recheck window, exactly
    //    like STALE_BG — bgRecheckMonths = 0 means "no policy", nothing is stale.
    type PersonRow = {
        personId: number;
        name: string;
        householdId: number;
        programId: number | null;
        programName: string | null;
        reason: string;
    };
    const peopleNeedingBgCheck: PersonRow[] = [];
    const peopleMissingDob: PersonRow[] = [];
    if (bgRecheckMonths > 0) {
        const threshold = bgFreshThreshold(boundary, bgRecheckMonths);
        const people = await prisma.person.findMany({
            where: {
                OR: [
                    { programParticipants: { some: {} } },
                    { programVolunteers: { some: {} } },
                    { programsLed: { some: {} } },
                ],
                ...LIVE_PERSON,
            },
            select: {
                id: true,
                name: true,
                householdId: true,
                dateOfBirth: true,
                isDeclaredAdult: true,
                lastBackgroundCheck: true,
                programParticipants: { select: { program: { select: { id: true, name: true } } } },
                programVolunteers: { select: { program: { select: { id: true, name: true } } } },
                programsLed: { select: { id: true, name: true } },
            },
            orderBy: { name: "asc" },
        });
        for (const p of people) {
            const verdict = personBgVerdict(p, boundary, threshold);
            if (verdict === "FRESH" || verdict === "MINOR") continue;
            // One program for context — first attachment found across the three roles.
            const prog =
                p.programParticipants[0]?.program ??
                p.programVolunteers[0]?.program ??
                p.programsLed[0] ??
                null;
            const row: PersonRow = {
                personId: p.id,
                name: p.name || `Person #${p.id}`,
                householdId: p.householdId,
                programId: prog?.id ?? null,
                programName: prog?.name ?? null,
                reason: verdict === "DOB_MISSING" ? "DOB_MISSING" : "PERSON_BG_NEEDED",
            };
            (verdict === "DOB_MISSING" ? peopleMissingDob : peopleNeedingBgCheck).push(row);
        }
    }

    // 5. Individual adult-child membership agreements. Independent of the BG
    //    recheck policy — this is a signature obligation, not a check.
    //    - awaiting: opened and not yet signed. The board's chase list.
    //    - notRequested: non-lead adults in member households that the nightly rule
    //      SKIPS because they're past its age ceiling (isDeclaredAdult = over 25). The
    //      board decides whether each is an adult child or an unmarked spouse.
    //    ponytail: the manual route accepts any personId, but this list only surfaces
    //    program-attached candidates — reaching someone not in a program needs a person
    //    picker we don't have a surface for yet.
    // subjectPerson is filtered through LIVE_PERSON as a relation filter: an obligation
    // whose subject was merged away must not stay on the board's chase list — the person
    // it names no longer exists to chase.
    const openAgreements = await prisma.orgMembershipProcess.findMany({
        where: { kind: "PERSON_AGREEMENT", status: "PENDING_EXTERNAL_ACTION", subjectPerson: { is: LIVE_PERSON } },
        select: { subjectPerson: { select: { id: true, name: true, householdId: true } } },
    });
    const peopleAwaitingAgreement: PersonRow[] = openAgreements
        .filter((p) => p.subjectPerson)
        .map((p) => ({
            personId: p.subjectPerson!.id,
            name: p.subjectPerson!.name || `Person #${p.subjectPerson!.id}`,
            householdId: p.subjectPerson!.householdId,
            programId: null,
            programName: null,
            reason: "AGREEMENT_OUTSTANDING",
        }));

    const overCeiling = await prisma.person.findMany({
        where: {
            isHouseholdLead: false,
            isDeclaredAdult: true,
            household: { orgMembership: { status: "ACTIVE" } },
            ...PROGRAM_ATTACHED_WHERE,
            ...LIVE_PERSON,
        },
        select: { id: true, name: true, householdId: true },
        orderBy: { name: "asc" },
    });
    const floor = settings?.orgMembershipYearBoundary ? agreementCycleFloor(settings.orgMembershipYearBoundary, new Date()) : null;
    const handled = await prisma.orgMembershipProcess.findMany({
        where: {
            kind: "PERSON_AGREEMENT",
            subjectPersonId: { in: overCeiling.map((p) => p.id) },
            OR: [
                { status: "PENDING_EXTERNAL_ACTION" },
                // No boundary configured ⇒ no cycle to roll, so any settled one counts.
                { status: { in: ["ACTIVE", "ARCHIVED"] }, ...(floor ? { stageEnteredAt: { gte: floor } } : {}) },
            ],
        },
        select: { subjectPersonId: true },
    });
    const handledIds = new Set(handled.map((h) => h.subjectPersonId));
    const peopleNeedingAgreement: PersonRow[] = overCeiling
        .filter((p) => !handledIds.has(p.id))
        .map((p) => ({
            personId: p.id,
            name: p.name || `Person #${p.id}`,
            householdId: p.householdId,
            programId: null,
            programName: null,
            reason: "AGREEMENT_NOT_REQUESTED",
        }));

    const agreementLists = { peopleAwaitingAgreement, peopleNeedingAgreement };

    if (reasons.size === 0) {
        return NextResponse.json({ households: [], peopleNeedingBgCheck, peopleMissingDob, ...agreementLists });
    }

    const households = await prisma.household.findMany({
        where: { id: { in: [...reasons.keys()] } },
        include: {
            householdMembers: {
                where: { isHouseholdLead: true, ...LIVE_PERSON },
                select: { id: true, name: true, phone: true, email: true, lastBackgroundCheck: true },
            },
        },
        orderBy: { name: "asc" },
    });

    const result = households.map((h) => {
        const checks = h.householdMembers
            .map((p) => p.lastBackgroundCheck)
            .filter((d): d is Date => d !== null);
        // Most recent lead check — the date the board is chasing on a STALE_BG row.
        const lastBackgroundCheck = checks.length
            ? checks.reduce((a, b) => (a > b ? a : b)).toISOString()
            : null;
        return {
            id: h.id,
            name: h.name || `Household #${h.id}`,
            reasons: [...(reasons.get(h.id) ?? [])],
            lastBackgroundCheck,
            leads: h.householdMembers.map((p) => ({
                id: p.id,
                name: p.name,
                phone: p.phone,
                email: p.email,
            })),
        };
    });

    return NextResponse.json({ households: result, peopleNeedingBgCheck, peopleMissingDob, ...agreementLists });
});
