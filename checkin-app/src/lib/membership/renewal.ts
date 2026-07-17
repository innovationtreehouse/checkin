import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { emailHouseholdLeads } from "@/lib/emailRecipients";
import { config } from "@/lib/config";

/**
 * Annual renewal. A common membership-year boundary (BoardSettings) drives every
 * household. Two months out, the cron opens a RENEWAL process at PENDING_RENEWAL
 * and reminds the household — the membership stays ACTIVE throughout.
 *
 * When the member begins renewal they enter the SAME external step a new applicant
 * gets (PENDING_EXTERNAL_ACTION): a fresh membership agreement is signed EVERY
 * cycle, and the background-check rule decides the other half — if EITHER parent's
 * background check is still valid at the boundary (lastBackgroundCheck within
 * BoardSettings.bgRecheckMonths of it, board-configured), bgClearedAt is stamped
 * and signing alone opens payment; otherwise the member requests a new background
 * check on Averity and the 2-of-N review runs in parallel with payment, exactly
 * like INITIAL. No auto-revoke — manual admin action. RENEWAL_PENDING_BG is legacy:
 * nothing writes it anymore (a migration moved open rows to the request flow).
 */

const SYSTEM_ACTOR = 0;
const RENEWAL_LEAD_MONTHS = 2;

/**
 * A renewal cycle counts as open while its process sits in any of these — the
 * request-flow states (PENDING_EXTERNAL_ACTION onward) included, or the sweep
 * would open a duplicate renewal for a household mid-flow. Must stay in step
 * with the partial unique index `membership_one_inflight_renewal` (raw SQL,
 * see the 20260715 renewal_bg_request_flow migration). BLOCKED is deliberately
 * out (pre-existing semantics: a blocked renewal is the board's to resolve).
 * RENEWAL_PENDING_BG is legacy — unwritten since that migration, still guarded.
 */
const IN_FLIGHT_RENEWAL_STATUSES = [
    "PENDING_RENEWAL",
    "PENDING_EXTERNAL_ACTION",
    "PENDING_BG_REVIEW",
    "PENDING_PAYMENT",
    "PENDING_BG_CLEARANCE",
    "RENEWAL_PENDING_BG",
] as const;

export class RenewalError extends Error {
    constructor(public readonly code: "not_found" | "wrong_phase", message: string) {
        super(message);
        this.name = "RenewalError";
    }
}

/** The next occurrence (>= now) of the boundary's month/day. */
export function nextBoundary(boundary: Date, now: Date): Date {
    const b = new Date(Date.UTC(now.getUTCFullYear(), boundary.getUTCMonth(), boundary.getUTCDate()));
    if (b.getTime() < now.getTime()) b.setUTCFullYear(b.getUTCFullYear() + 1);
    return b;
}

function monthsBefore(date: Date, months: number): Date {
    const d = new Date(date);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d;
}

/**
 * From a configured boundary date, the next boundary occurrence and whether `now`
 * sits inside the renewal lead window before it. Pure; the single source of the
 * "are we in renewal season" calc shared by runRenewalSweep and isRenewalSeason.
 */
export function renewalWindow(configuredBoundary: Date, now: Date): { boundary: Date; windowStart: Date; inSeason: boolean } {
    const boundary = nextBoundary(configuredBoundary, now);
    const windowStart = monthsBefore(boundary, RENEWAL_LEAD_MONTHS);
    return { boundary, windowStart, inSeason: now.getTime() >= windowStart.getTime() };
}

/**
 * True when `now` sits inside the renewal lead window before the configured
 * boundary — the same window runRenewalSweep opens/reminds on. No boundary set
 * ⇒ not renewal season. Drives the admin "Grant for coming year" button.
 */
export async function isRenewalSeason(now: Date): Promise<boolean> {
    return (await renewalSeasonWindow(now)) !== null;
}

/**
 * The live renewal window when `now` is inside it, else null. Callers that need
 * the window bounds (e.g. "was this cycle already resolved?") use this instead of
 * re-reading BoardSettings themselves.
 */
export async function renewalSeasonWindow(now: Date): Promise<{ boundary: Date; windowStart: Date } | null> {
    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: { orgMembershipYearBoundary: true },
    });
    if (!settings?.orgMembershipYearBoundary) return null;
    const { boundary, windowStart, inSeason } = renewalWindow(settings.orgMembershipYearBoundary, now);
    return inSeason ? { boundary, windowStart } : null;
}

/**
 * Open renewal processes for every ACTIVE membership due within the lead window,
 * unless one was already opened this cycle. Returns a summary.
 */
export async function runRenewalSweep(now: Date) {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    if (!settings?.orgMembershipYearBoundary) {
        return { opened: 0, skipped: 0, reason: "no membership-year boundary configured" };
    }

    const { boundary, windowStart, inSeason } = renewalWindow(settings.orgMembershipYearBoundary, now);
    if (!inSeason) {
        return { opened: 0, skipped: 0, reason: "not yet within renewal window" };
    }

    const memberships = await prisma.orgMembership.findMany({
        where: { status: "ACTIVE" },
        // "Handled this cycle" = an in-flight RENEWAL by status (matches the partial
        // unique index + openRenewalsForAllActive), OR a RENEWAL already resolved this
        // cycle — a member who finished renewal early, or the admin "Grant for coming
        // year" override, both leave a terminal (ACTIVE/ARCHIVED) RENEWAL with
        // stageEnteredAt in this window. Without the second clause a completed renewal
        // gets re-opened + re-reminded, since terminal rows aren't in-flight.
        select: {
            id: true, householdId: true,
            processes: {
                where: {
                    kind: "RENEWAL",
                    OR: [
                        { status: { in: [...IN_FLIGHT_RENEWAL_STATUSES] } },
                        { status: { in: ["ACTIVE", "ARCHIVED"] }, stageEnteredAt: { gte: windowStart } },
                    ],
                },
                select: { id: true },
            },
        },
    });

    let opened = 0;
    let skipped = 0;
    for (const m of memberships) {
        if (m.processes.length > 0) { skipped++; continue; } // already opened this cycle
        const p = await createRenewalProcess(m.id, m.householdId, now, { remind: true, boundary });
        if (p) opened++; else skipped++; // null = concurrent run beat us to it
    }

    return { opened, skipped, boundary: boundary.toISOString() };
}

/**
 * Member begins renewal: PENDING_RENEWAL -> PENDING_EXTERNAL_ACTION, always — a
 * fresh membership agreement is signed every cycle. A still-valid background
 * check (no household note) is pre-cleared so only the signature is left;
 * otherwise the member also requests a new background check, same flow as
 * INITIAL. Idempotent-ish: only acts from PENDING_RENEWAL.
 */
export async function beginRenewal(processId: number) {
    const process = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new RenewalError("not_found", "Renewal not found.");
    if (process.status !== "PENDING_RENEWAL") throw new RenewalError("wrong_phase", "This renewal is not awaiting your confirmation.");

    // A RENEWAL always has a membership (orgMembershipId is only null for PERSON_BG).
    const membership = await prisma.orgMembership.findUnique({
        where: { id: process.orgMembershipId! },
        select: { householdId: true, household: { select: { intakeNotes: true } } },
    });
    if (!membership) throw new RenewalError("not_found", "Membership not found.");
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const boundary = settings?.orgMembershipYearBoundary ? nextBoundary(settings.orgMembershipYearBoundary, new Date()) : new Date();
    const bgFresh = await householdBgIsFresh(membership.householdId, boundary, settings?.bgRecheckMonths ?? 0);
    const hasNote = !!membership.household.intakeNotes?.trim();

    // A still-valid background check with no household note ⇒ stamp bgClearedAt
    // now: the external card shows "no new background check needed" and the
    // signature alone opens payment. A note (#900) disqualifies the shortcut
    // exactly like submitIntake —
    // the member consents anyway and advanceExternalIfComplete holds the process
    // at PENDING_BG_REVIEW so the note reaches a reviewer before payment (#907).
    // Reviewers are NOT pinged here — nothing is reviewable until consent is
    // recorded; the advance pings them, same as INITIAL. Volunteer allowlist
    // matching (#874) also happens at the advance's PENDING_PAYMENT transition.
    const clearNow = bgFresh && !hasNote;
    // Conditional on status PENDING_RENEWAL: a double-submit has both callers reach
    // here, but only the winner's updateMany flips it (count === 1) — so the audit
    // row is written exactly once. Mirrors external.ts markContractSigned.
    const { count } = await prisma.orgMembershipProcess.updateMany({
        where: { id: processId, status: "PENDING_RENEWAL" },
        data: { status: "PENDING_EXTERNAL_ACTION", stageEnteredAt: new Date(), ...(clearNow ? { bgClearedAt: new Date() } : {}) },
    });
    if (count === 1) {
        await prisma.auditLog.create({
            data: { actorId: SYSTEM_ACTOR, action: "EDIT", tableName: "OrgMembershipProcess", affectedEntityId: processId, oldData: { status: "PENDING_RENEWAL" }, newData: { status: "PENDING_EXTERNAL_ACTION", ...(clearNow ? { bgClearedAt: true } : {}) } },
        });
    }
    return prisma.orgMembershipProcess.findUniqueOrThrow({ where: { id: processId } });
}

/**
 * Create one PENDING_RENEWAL process (+ audit, optional reminder), or no-op if one
 * is already in flight. The callers' check-then-act is NOT atomic, so this function
 * serializes its own check+insert by locking the parent Membership row (SELECT ...
 * FOR UPDATE): a concurrent sweep/admin-button/double-click blocks until the winner
 * commits, then sees the winner's in-flight process and returns null — no duplicate
 * audit row, no duplicate household reminder. This holds in every environment, not
 * just one provisioned via `migrate deploy` (the partial unique index
 * `membership_one_inflight_renewal` is migration-only — `prisma db push` and the
 * integration test DBs don't have it). The index stays as defense-in-depth and the
 * P2002 catch as a backstop. Returns null when this call lost the race.
 */
export async function createRenewalProcess(orgMembershipId: number, householdId: number, now: Date, opts: { remind: boolean; boundary: Date }) {
    let process;
    try {
        process = await prisma.$transaction(async (tx) => {
            // Lock the membership row so overlapping opens serialize here, not at the INSERT.
            await tx.$queryRaw`SELECT id FROM "OrgMembership" WHERE id = ${orgMembershipId} FOR UPDATE`;
            const existing = await tx.orgMembershipProcess.findFirst({
                where: { orgMembershipId, kind: "RENEWAL", status: { in: [...IN_FLIGHT_RENEWAL_STATUSES] } },
                select: { id: true },
            });
            if (existing) return null; // someone else already opened the renewal
            const created = await tx.orgMembershipProcess.create({
                data: { orgMembershipId, kind: "RENEWAL", status: "PENDING_RENEWAL", renewalReminderSentAt: opts.remind ? now : null },
            });
            await tx.auditLog.create({
                data: { actorId: SYSTEM_ACTOR, action: "CREATE", tableName: "OrgMembershipProcess", affectedEntityId: created.id, newData: { kind: "RENEWAL", status: "PENDING_RENEWAL" } },
            });
            return created;
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            logger.info("Renewal already in flight for membership %d — concurrent open, skipping", orgMembershipId);
            return null;
        }
        throw e;
    }
    if (!process) {
        logger.info("Renewal already in flight for membership %d — concurrent open, skipping", orgMembershipId);
        return null;
    }
    if (opts.remind) await remindHousehold(householdId, opts.boundary);
    return process;
}

/**
 * Go-live migration: open a renewal cycle for EVERY active membership that isn't
 * already mid-renewal, ignoring the date window. Reminders are opt-in (default
 * off) to avoid an unexpected mass email blast on the button press — the board
 * can send them deliberately or let the normal cron remind on schedule.
 */
export async function openRenewalsForAllActive(now: Date, opts: { sendReminders?: boolean } = {}) {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const boundary = settings?.orgMembershipYearBoundary ? nextBoundary(settings.orgMembershipYearBoundary, now) : now;

    const memberships = await prisma.orgMembership.findMany({
        where: { status: "ACTIVE" },
        select: {
            id: true,
            householdId: true,
            processes: { where: { kind: "RENEWAL", status: { in: [...IN_FLIGHT_RENEWAL_STATUSES] } }, select: { id: true } },
        },
    });

    let opened = 0;
    let skipped = 0;
    for (const m of memberships) {
        if (m.processes.length > 0) { skipped++; continue; }
        const p = await createRenewalProcess(m.id, m.householdId, now, { remind: !!opts.sendReminders, boundary });
        if (p) opened++; else skipped++; // null = concurrent run beat us to it
    }
    return { opened, skipped };
}

/** Resolve and begin the caller's household renewal. */
export async function beginRenewalForUser(userId: number) {
    const user = await prisma.person.findUnique({ where: { id: userId }, select: { householdId: true } });
    if (!user?.householdId) throw new RenewalError("not_found", "You are not in a household.");
    const process = await prisma.orgMembershipProcess.findFirst({
        where: { orgMembership: { householdId: user.householdId }, status: "PENDING_RENEWAL" },
        orderBy: { id: "desc" },
    });
    if (!process) throw new RenewalError("wrong_phase", "No renewal is awaiting your confirmation.");
    return beginRenewal(process.id);
}

/**
 * True if EITHER guardian (household lead) has a background check still valid at the boundary,
 * i.e. lastBackgroundCheck >= boundary - recheckMonths. When recheckMonths is 0 (the
 * board hasn't set the policy), nothing counts as fresh — renewals re-run review.
 */
export async function householdBgIsFresh(householdId: number, boundary: Date, recheckMonths: number): Promise<boolean> {
    if (recheckMonths <= 0) return false;
    const threshold = monthsBefore(boundary, recheckMonths);
    const fresh = await prisma.person.findFirst({
        where: { householdId, isHouseholdLead: true, lastBackgroundCheck: { gte: threshold } },
        select: { id: true },
    });
    return fresh !== null;
}

async function remindHousehold(householdId: number, boundary: Date) {
    const base = config.baseUrl();
    const due = boundary.toISOString().slice(0, 10);
    await emailHouseholdLeads(
        householdId,
        "Time to renew your Treehouse membership",
        `<p>Your household membership is up for renewal by ${due}. Please sign in to renew: <a href="${base}/membership">${base}/membership</a></p>`,
        "Renewal reminder failed:",
    );
}
