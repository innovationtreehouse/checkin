import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { notifyReviewers } from "@/lib/membership/review";

/**
 * Annual renewal. A common membership-year boundary (BoardSettings) drives every
 * household. Two months out, the cron opens a RENEWAL process at PENDING_RENEWAL
 * and reminds the household — the membership stays ACTIVE throughout.
 *
 * When the member begins renewal, the 3-year background-check rule decides the
 * path: if EITHER parent's lastBackgroundCheck is within 3 years of the boundary,
 * skip straight to PENDING_PAYMENT; otherwise re-run review (RENEWAL_PENDING_BG).
 * The Zoho contract is NOT re-signed at renewal. No auto-revoke — that's a manual
 * admin action.
 */

const SYSTEM_ACTOR = 0;
const RENEWAL_LEAD_MONTHS = 2;
const BG_VALID_YEARS = 3;

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
        select: { id: true, householdId: true, processes: { where: { kind: "RENEWAL", createdAt: { gte: windowStart } }, select: { id: true } } },
    });

    let opened = 0;
    let skipped = 0;
    for (const m of memberships) {
        if (m.processes.length > 0) { skipped++; continue; } // already opened this cycle
        const process = await prisma.membershipProcess.create({
            data: { membershipId: m.id, kind: "RENEWAL", status: "PENDING_RENEWAL" },
        });
        await prisma.membershipProcess.update({ where: { id: process.id }, data: { renewalReminderSentAt: now } });
        await prisma.auditLog.create({
            data: { actorId: SYSTEM_ACTOR, action: "CREATE", tableName: "MembershipProcess", affectedEntityId: process.id, newData: JSON.stringify({ kind: "RENEWAL", status: "PENDING_RENEWAL" }) },
        });
        await remindHousehold(m.householdId, boundary);
        opened++;
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
    const bgFresh = await householdBgIsFresh(membership.householdId, boundary);

    const nextStatus = bgFresh ? "PENDING_PAYMENT" : "RENEWAL_PENDING_BG";
    const updated = await prisma.membershipProcess.update({ where: { id: processId }, data: { status: nextStatus, stageEnteredAt: new Date() } });
    await prisma.auditLog.create({
        data: { actorId: SYSTEM_ACTOR, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, oldData: JSON.stringify({ status: "PENDING_RENEWAL" }), newData: JSON.stringify({ status: nextStatus }) },
    });
    if (nextStatus === "RENEWAL_PENDING_BG") await notifyReviewers();
    return updated;
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

/** True if EITHER guardian (household lead) has a lastBackgroundCheck within BG_VALID_YEARS of the boundary. */
export async function householdBgIsFresh(householdId: number, boundary: Date): Promise<boolean> {
    const threshold = new Date(boundary);
    threshold.setUTCFullYear(threshold.getUTCFullYear() - BG_VALID_YEARS);
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
