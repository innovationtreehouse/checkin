import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { notifyReviewers } from "@/lib/membership/review";

/**
 * Annual renewal. A common membership-year boundary (BoardSettings) drives every
 * household. Two months out, the cron opens a RENEWAL process at PENDING_RENEWAL
 * and reminds the household — the membership stays ACTIVE throughout.
 *
 * When the member begins renewal, the background-check rule decides the path: if
 * EITHER parent's check is still valid at the boundary (lastBackgroundCheck within
 * BoardSettings.bgRecheckMonths of it), skip straight to PENDING_PAYMENT; otherwise
 * re-run review (RENEWAL_PENDING_BG). The interval is board-configured, not hardcoded.
 * The Zoho contract is NOT re-signed at renewal. No auto-revoke — manual admin action.
 */

const SYSTEM_ACTOR = 0;
const RENEWAL_LEAD_MONTHS = 2;

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
 * Open renewal processes for every ACTIVE membership due within the lead window,
 * unless one was already opened this cycle. Returns a summary.
 */
export async function runRenewalSweep(now: Date) {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    if (!settings?.membershipYearBoundary) {
        return { opened: 0, skipped: 0, reason: "no membership-year boundary configured" };
    }

    const boundary = nextBoundary(settings.membershipYearBoundary, now);
    const windowStart = monthsBefore(boundary, RENEWAL_LEAD_MONTHS);
    if (now.getTime() < windowStart.getTime()) {
        return { opened: 0, skipped: 0, reason: "not yet within renewal window" };
    }

    const memberships = await prisma.membership.findMany({
        where: { status: "ACTIVE" },
        // "Already open" = an in-flight RENEWAL by status (matches the partial unique
        // index + openRenewalsForAllActive), not the leakier createdAt window.
        select: { id: true, householdId: true, processes: { where: { kind: "RENEWAL", status: { in: ["PENDING_RENEWAL", "RENEWAL_PENDING_BG", "PENDING_PAYMENT"] } }, select: { id: true } } },
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
 * Member begins renewal: PENDING_RENEWAL -> RENEWAL_PENDING_BG (re-review needed)
 * or PENDING_PAYMENT (background check still valid). Idempotent-ish: only acts
 * from PENDING_RENEWAL.
 */
export async function beginRenewal(processId: number) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new RenewalError("not_found", "Renewal not found.");
    if (process.status !== "PENDING_RENEWAL") throw new RenewalError("wrong_phase", "This renewal is not awaiting your confirmation.");

    const membership = await prisma.membership.findUnique({ where: { id: process.membershipId }, select: { householdId: true } });
    if (!membership) throw new RenewalError("not_found", "Membership not found.");
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const boundary = settings?.membershipYearBoundary ? nextBoundary(settings.membershipYearBoundary, new Date()) : new Date();
    const bgFresh = await householdBgIsFresh(membership.householdId, boundary, settings?.bgRecheckMonths ?? 0);

    const nextStatus = bgFresh ? "PENDING_PAYMENT" : "RENEWAL_PENDING_BG";
    // Conditional on status PENDING_RENEWAL: a double-submit has both callers reach
    // here, but only the winner's updateMany flips it (count === 1) — so the audit
    // row and reviewer ping fire exactly once. Mirrors external.ts markContractSigned.
    const { count } = await prisma.membershipProcess.updateMany({
        where: { id: processId, status: "PENDING_RENEWAL" },
        data: { status: nextStatus, stageEnteredAt: new Date() },
    });
    if (count === 1) {
        await prisma.auditLog.create({
            data: { actorId: SYSTEM_ACTOR, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, oldData: JSON.stringify({ status: "PENDING_RENEWAL" }), newData: JSON.stringify({ status: nextStatus }) },
        });
        if (nextStatus === "RENEWAL_PENDING_BG") await notifyReviewers();
    }
    return prisma.membershipProcess.findUnique({ where: { id: processId } });
}

/**
 * Create one PENDING_RENEWAL process (+ audit, optional reminder), or no-op if one
 * is already in flight. The check-then-act in the callers is NOT atomic, so the
 * partial unique index `membership_one_inflight_renewal` is the real guard: a
 * concurrent sweep/admin-button/double-click that wins the insert leaves the loser
 * here catching P2002 and returning null — no duplicate audit row, no duplicate
 * household reminder. Returns null when the create lost the race. The index, not
 * this catch, is the guarantee; we stay lazy and skip the pre-insert advisory lock.
 */
export async function createRenewalProcess(membershipId: number, householdId: number, now: Date, opts: { remind: boolean; boundary: Date }) {
    let process;
    try {
        process = await prisma.membershipProcess.create({
            data: { membershipId, kind: "RENEWAL", status: "PENDING_RENEWAL", renewalReminderSentAt: opts.remind ? now : null },
        });
    } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
            logger.info("Renewal already in flight for membership %d — concurrent open, skipping", membershipId);
            return null;
        }
        throw e;
    }
    await prisma.auditLog.create({
        data: { actorId: SYSTEM_ACTOR, action: "CREATE", tableName: "MembershipProcess", affectedEntityId: process.id, newData: JSON.stringify({ kind: "RENEWAL", status: "PENDING_RENEWAL" }) },
    });
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
    const boundary = settings?.membershipYearBoundary ? nextBoundary(settings.membershipYearBoundary, now) : now;

    const memberships = await prisma.membership.findMany({
        where: { status: "ACTIVE" },
        select: {
            id: true,
            householdId: true,
            processes: { where: { kind: "RENEWAL", status: { in: ["PENDING_RENEWAL", "RENEWAL_PENDING_BG", "PENDING_PAYMENT"] } }, select: { id: true } },
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
    const user = await prisma.participant.findUnique({ where: { id: userId }, select: { householdId: true } });
    if (!user?.householdId) throw new RenewalError("not_found", "You are not in a household.");
    const process = await prisma.membershipProcess.findFirst({
        where: { membership: { householdId: user.householdId }, status: "PENDING_RENEWAL" },
        orderBy: { id: "desc" },
    });
    if (!process) throw new RenewalError("wrong_phase", "No renewal is awaiting your confirmation.");
    return beginRenewal(process.id);
}

/**
 * True if EITHER guardian (household lead) has a check still valid at the boundary,
 * i.e. lastBackgroundCheck >= boundary - recheckMonths. When recheckMonths is 0 (the
 * board hasn't set the policy), nothing counts as fresh — renewals re-run review.
 */
export async function householdBgIsFresh(householdId: number, boundary: Date, recheckMonths: number): Promise<boolean> {
    if (recheckMonths <= 0) return false;
    const threshold = monthsBefore(boundary, recheckMonths);
    const fresh = await prisma.participant.findFirst({
        where: { householdId, householdLeads: { some: { householdId } }, lastBackgroundCheck: { gte: threshold } },
        select: { id: true },
    });
    return fresh !== null;
}

async function remindHousehold(householdId: number, boundary: Date) {
    try {
        const leads = await prisma.householdLead.findMany({ where: { householdId }, select: { participant: { select: { email: true } } } });
        const base = process.env.NEXTAUTH_URL ?? "";
        const due = boundary.toISOString().slice(0, 10);
        await Promise.all(
            leads
                .map((l) => l.participant?.email)
                .filter((e): e is string => !!e)
                .map((email) =>
                    sendEmail(
                        email,
                        "Time to renew your Treehouse membership",
                        `<p>Your household membership is up for renewal by ${due}. Please sign in to renew: <a href="${base}/membership">${base}/membership</a></p>`,
                    ).catch((e) => logger.error("Renewal reminder failed:", e)),
                ),
        );
    } catch (e) {
        logger.error("remindHousehold failed:", e);
    }
}
