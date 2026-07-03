import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { emailHouseholdLeads } from "@/lib/emailRecipients";
import { notifyReviewers } from "@/lib/membership/review";
import { config } from "@/lib/config";

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
    if (!settings?.orgMembershipYearBoundary) {
        return { opened: 0, skipped: 0, reason: "no membership-year boundary configured" };
    }

    const boundary = nextBoundary(settings.orgMembershipYearBoundary, now);
    const windowStart = monthsBefore(boundary, RENEWAL_LEAD_MONTHS);
    if (now.getTime() < windowStart.getTime()) {
        return { opened: 0, skipped: 0, reason: "not yet within renewal window" };
    }

    const memberships = await prisma.orgMembership.findMany({
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
    const process = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new RenewalError("not_found", "Renewal not found.");
    if (process.status !== "PENDING_RENEWAL") throw new RenewalError("wrong_phase", "This renewal is not awaiting your confirmation.");

    const membership = await prisma.orgMembership.findUnique({ where: { id: process.orgMembershipId }, select: { householdId: true } });
    if (!membership) throw new RenewalError("not_found", "Membership not found.");
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const boundary = settings?.orgMembershipYearBoundary ? nextBoundary(settings.orgMembershipYearBoundary, new Date()) : new Date();
    const bgFresh = await householdBgIsFresh(membership.householdId, boundary, settings?.bgRecheckMonths ?? 0);

    const nextStatus = bgFresh ? "PENDING_PAYMENT" : "RENEWAL_PENDING_BG";
    // Conditional on status PENDING_RENEWAL: a double-submit has both callers reach
    // here, but only the winner's updateMany flips it (count === 1) — so the audit
    // row and reviewer ping fire exactly once. Mirrors external.ts markContractSigned.
    // Fresh check ⇒ no re-review, so clear the BG requirement here (there's no
    // consent step / reviewer queue for a fresh renewal). Without this the renewal
    // pays and parks at PENDING_BG_CLEARANCE forever. Re-review renewals
    // (RENEWAL_PENDING_BG) get bgClearedAt from clearBackgroundCheck instead.
    const { count } = await prisma.orgMembershipProcess.updateMany({
        where: { id: processId, status: "PENDING_RENEWAL" },
        data: { status: nextStatus, stageEnteredAt: new Date(), ...(bgFresh ? { bgClearedAt: new Date() } : {}) },
    });
    if (count === 1) {
        await prisma.auditLog.create({
            data: { actorId: SYSTEM_ACTOR, action: "EDIT", tableName: "OrgMembershipProcess", affectedEntityId: processId, oldData: { status: "PENDING_RENEWAL" }, newData: { status: nextStatus, ...(bgFresh ? { bgClearedAt: true } : {}) } },
        });
        if (nextStatus === "RENEWAL_PENDING_BG") await notifyReviewers();
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
                where: { orgMembershipId, kind: "RENEWAL", status: { in: ["PENDING_RENEWAL", "RENEWAL_PENDING_BG", "PENDING_PAYMENT"] } },
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
 * True if EITHER guardian (household lead) has a check still valid at the boundary,
 * i.e. lastBackgroundCheck >= boundary - recheckMonths. When recheckMonths is 0 (the
 * board hasn't set the policy), nothing counts as fresh — renewals re-run review.
 */
export async function householdBgIsFresh(householdId: number, boundary: Date, recheckMonths: number): Promise<boolean> {
    if (recheckMonths <= 0) return false;
    const threshold = monthsBefore(boundary, recheckMonths);
    const fresh = await prisma.person.findFirst({
        where: { householdId, householdLeads: { some: { householdId } }, lastBackgroundCheck: { gte: threshold } },
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
