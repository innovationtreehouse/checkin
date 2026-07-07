import type { OrgMembershipStatus, OrgMembershipProcessStatus } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { config } from "@/lib/config";
import { escapeHtml } from "@/lib/email-templates/base";
import { emailHouseholdLeads, emailBoardMembers } from "@/lib/emailRecipients";
import { withdrawAndReleaseHold } from "@/lib/program/capacity";
import { nextBoundary } from "@/lib/membership/renewal";

/**
 * Membership lapse/revocation → program-enrollment cascade.
 * (Design: docs/designs/MEMBERSHIP_LAPSE_CASCADE.md; interview decision
 * "grace then auto-withdraw", 2026-07-07.)
 *
 * A household's membership "lapses" when it loses a membership it held:
 *   - status REVOKED or DENIED (a board act), or
 *   - status ACTIVE but a RENEWAL process is still incomplete past the membership
 *     year boundary (the "year boundary passed without renewal" case).
 * NONE / no-membership never lapses — those are legitimate non-members, whose
 * (non-member-priced) program enrollments must not be swept.
 *
 * Lapsed-ness is DERIVED live from OrgMembership (isMembershipLapsed) everywhere
 * it gates behavior — the check-in and enrollment guards and this cron — so a
 * renewal clears the block the instant status/renewal state changes, with no
 * stamp to keep in sync. OrgMembership.lapseFlaggedAt is only a grace-clock +
 * notification-dedup stamp maintained by the cron, never the source of truth for
 * "is this household blocked right now?".
 */

const SYSTEM_ACTOR = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

/** RENEWAL process statuses that mean "renewal is still in flight" (not yet
 * completed/abandoned). Mirrors the set renewal.ts treats as an open renewal. */
export const RENEWAL_INCOMPLETE: readonly OrgMembershipProcessStatus[] = [
    "PENDING_RENEWAL",
    "RENEWAL_PENDING_BG",
    "PENDING_PAYMENT",
];

/** Pure grace-window math: has `flaggedAt` aged past `graceDays` as of `now`?
 * graceDays 0 = no grace (withdraw the run it's flagged); the caller only invokes
 * this when a grace period is configured (NULL grace = auto-withdraw off). */
export function isPastGrace(flaggedAt: Date, graceDays: number, now: Date): boolean {
    return flaggedAt.getTime() <= now.getTime() - graceDays * DAY_MS;
}

/** Minimal loaded shape the pure predicate needs. */
export interface LapseInput {
    status: OrgMembershipStatus;
    /** Incomplete RENEWAL processes for this membership (createdAt only). */
    renewalProcesses: { createdAt: Date }[];
}

/**
 * Pure predicate: is this membership currently lapsed? Derives entirely from the
 * membership's status + its incomplete renewal processes + the global year
 * boundary — no dependence on lapseFlaggedAt (that's grace/dedup only).
 *
 * A renewal opens ~RENEWAL_LEAD_MONTHS before the boundary B, so
 * nextBoundary(boundaryMonthDay, process.createdAt) === B; once now > B the
 * renewal is overdue and the household has lapsed. (Late-opened renewals resolve
 * to the next boundary — the derivation flags conservatively, never early.)
 */
export function isMembershipLapsed(
    m: LapseInput,
    boundaryMonthDay: Date | null | undefined,
    now: Date,
): boolean {
    if (m.status === "REVOKED" || m.status === "DENIED") return true;
    if (m.status !== "ACTIVE") return false; // NONE / never a member
    if (!boundaryMonthDay) return false; // no boundary configured → nothing is overdue
    return m.renewalProcesses.some(
        (p) => now.getTime() > nextBoundary(boundaryMonthDay, p.createdAt).getTime(),
    );
}

/**
 * Guard helper for the check-in (scan) and new-enrollment routes: does this
 * person's household have a currently-lapsed membership? Derives live. Cheap for
 * the common case — REVOKED/DENIED short-circuits with no boundary lookup, and an
 * ACTIVE membership with no in-flight renewal returns before fetching settings.
 */
export async function householdMembershipLapsed(householdId: number | null | undefined): Promise<boolean> {
    if (!householdId) return false;
    const m = await prisma.orgMembership.findUnique({
        where: { householdId },
        select: {
            status: true,
            processes: {
                where: { kind: "RENEWAL", status: { in: [...RENEWAL_INCOMPLETE] } },
                select: { createdAt: true },
            },
        },
    });
    if (!m) return false;
    if (m.status === "REVOKED" || m.status === "DENIED") return true;
    if (m.status !== "ACTIVE" || m.processes.length === 0) return false;
    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: { orgMembershipYearBoundary: true },
    });
    return isMembershipLapsed({ status: m.status, renewalProcesses: m.processes }, settings?.orgMembershipYearBoundary, new Date());
}

/** One household notice to the household's leads. Best-effort (errors swallowed). */
async function notifyLapsedHousehold(householdId: number, graceDays: number | null): Promise<void> {
    const base = config.baseUrl();
    const graceLine =
        graceDays !== null
            ? `<p>If your membership isn't renewed within <strong>${graceDays} day(s)</strong>, those enrollments will be automatically withdrawn.</p>`
            : "";
    await emailHouseholdLeads(
        householdId,
        "Your Treehouse membership has lapsed",
        `<p>Your household's Treehouse membership has lapsed. While it is lapsed, household members can't check in or enroll in new programs, and existing program enrollments are flagged.</p>${graceLine}<p>Renew here: <a href="${base}/membership">${base}/membership</a></p>`,
        "Membership-lapse household notice failed:",
    );
}

/** Single board digest listing every household newly flagged this run. */
async function notifyBoardOfLapses(households: { householdId: number; name: string | null }[]): Promise<void> {
    if (households.length === 0) return;
    const base = config.baseUrl();
    const rows = households
        .map(
            (h) =>
                `<li><a href="${base}/membership-ops/households/${h.householdId}">${escapeHtml(h.name || `Household #${h.householdId}`)}</a></li>`,
        )
        .join("");
    await emailBoardMembers(
        `Membership lapses: ${households.length} household(s) flagged`,
        `<p>The following household(s) lapsed and had their program enrollments flagged (members blocked from check-in and new enrollment):</p><ul>${rows}</ul>`,
        "Membership-lapse board digest failed:",
    );
}

/**
 * Auto-withdraw a lapsed household's PENDING program enrollments, one row at a
 * time through withdrawAndReleaseHold so every scholarship hold is released +1
 * exactly once (a bulk deleteMany would delete the rows but skip the Shopify
 * seat restore — the correctness point tested in the sweep integration test).
 *
 * Only PENDING (awaiting payment / scholarship-held) rows are swept. ACTIVE rows
 * are paid/comped completed transactions: deleting one restores no seat (the sale
 * already decremented Shopify and withdrawAndReleaseHold only +1s a held seat),
 * so auto-withdrawing it would destroy paid value and drift capacity. Paying a
 * PENDING enrollment during grace therefore "rescues" it — it becomes ACTIVE and
 * is no longer swept. Returns the number of rows withdrawn.
 */
async function withdrawHouseholdPendingEnrollments(householdId: number, graceDays: number): Promise<number> {
    const enrollments = await prisma.programParticipant.findMany({
        where: { status: "PENDING", person: { householdId } },
        include: {
            program: {
                select: {
                    id: true,
                    name: true,
                    shopifyVariantId: true,
                    shopifyOrgMemberVariantId: true,
                    shopifyNonOrgMemberVariantId: true,
                },
            },
            person: { select: { name: true } },
        },
    });

    let withdrawn = 0;
    for (const e of enrollments) {
        try {
            await withdrawAndReleaseHold(e.programId, e.personId, e.program);
            await prisma.auditLog.create({
                data: {
                    actorId: SYSTEM_ACTOR,
                    action: "DELETE",
                    tableName: "ProgramParticipant",
                    affectedEntityId: e.personId,
                    secondaryAffectedEntity: e.programId,
                    newData: { reason: "membership_lapse_withdrawn", graceDays },
                },
            });
            withdrawn++;
            logger.info(`[CRON] Auto-withdrew ${e.person.name} from ${e.program.name} — membership lapsed past ${graceDays}d grace.`);
        } catch (err) {
            // Isolate one bad row from the rest of the sweep.
            logger.error(`[CRON] Failed to withdraw participant ${e.personId} from program ${e.programId} (lapse cascade):`, err);
        }
    }
    return withdrawn;
}

/**
 * The daily membership-lapse cascade sweep (body of GET /api/cron/membership-lapse-cascade).
 *
 * 1. Find currently-lapsed memberships (derived).
 * 2. Newly-lapsed (lapseFlaggedAt null) → stamp lapseFlaggedAt, audit, notify the
 *    household once, and collect for one board digest (dedup: an already-flagged
 *    household is never re-notified).
 * 3. If BoardSettings.membershipLapseGraceDays is set (NULL = auto-withdraw off),
 *    auto-withdraw the PENDING enrollments of every lapsed household flagged longer
 *    ago than the grace window.
 * 4. Clear lapseFlaggedAt on memberships that were flagged but are no longer lapsed
 *    (renewed / reactivated) — so a future re-lapse notifies again.
 */
export async function runLapseCascadeSweep(now: Date = new Date()) {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const boundary = settings?.orgMembershipYearBoundary ?? null;
    const graceDays = settings?.membershipLapseGraceDays ?? null; // null = auto-withdraw OFF

    const candidates = await prisma.orgMembership.findMany({
        where: {
            OR: [
                { status: { in: ["REVOKED", "DENIED"] } },
                { status: "ACTIVE", processes: { some: { kind: "RENEWAL", status: { in: [...RENEWAL_INCOMPLETE] } } } },
            ],
        },
        select: {
            id: true,
            householdId: true,
            status: true,
            lapseFlaggedAt: true,
            household: { select: { name: true } },
            processes: {
                where: { kind: "RENEWAL", status: { in: [...RENEWAL_INCOMPLETE] } },
                select: { createdAt: true },
            },
        },
    });

    const lapsed = candidates.filter((m) =>
        isMembershipLapsed({ status: m.status, renewalProcesses: m.processes }, boundary, now),
    );

    // 2. Flag + notify the newly-lapsed (dedup on lapseFlaggedAt == null).
    // ponytail: sequential per-household await, like the other crons — fine at org
    // scale (bounded by lapsed households/day); parallelize if a run ever gets slow.
    const newlyFlagged = lapsed.filter((m) => m.lapseFlaggedAt === null);
    for (const m of newlyFlagged) {
        await prisma.orgMembership.update({ where: { id: m.id }, data: { lapseFlaggedAt: now } });
        await prisma.auditLog.create({
            data: {
                actorId: SYSTEM_ACTOR,
                action: "EDIT",
                tableName: "OrgMembership",
                affectedEntityId: m.id,
                secondaryAffectedEntity: m.householdId,
                newData: { reason: "membership_lapsed", status: m.status },
            },
        });
        await notifyLapsedHousehold(m.householdId, graceDays);
    }
    await notifyBoardOfLapses(newlyFlagged.map((m) => ({ householdId: m.householdId, name: m.household.name })));

    // 3. Auto-withdraw past-grace lapsed households' PENDING enrollments.
    let withdrawn = 0;
    if (graceDays !== null) {
        for (const m of lapsed) {
            // Just-flagged rows use `now` as their flag time (graceDays 0 => withdraw same run).
            if (isPastGrace(m.lapseFlaggedAt ?? now, graceDays, now)) {
                withdrawn += await withdrawHouseholdPendingEnrollments(m.householdId, graceDays);
            }
        }
    }

    // 4. Clear stale flags — flagged memberships that are no longer lapsed.
    const lapsedIds = lapsed.map((m) => m.id);
    const stale = await prisma.orgMembership.findMany({
        where: { lapseFlaggedAt: { not: null }, id: { notIn: lapsedIds } },
        select: { id: true, householdId: true },
    });
    for (const m of stale) {
        await prisma.orgMembership.update({ where: { id: m.id }, data: { lapseFlaggedAt: null } });
        await prisma.auditLog.create({
            data: {
                actorId: SYSTEM_ACTOR,
                action: "EDIT",
                tableName: "OrgMembership",
                affectedEntityId: m.id,
                secondaryAffectedEntity: m.householdId,
                newData: { reason: "membership_lapse_cleared" },
            },
        });
    }

    return {
        candidates: candidates.length,
        lapsed: lapsed.length,
        newlyFlagged: newlyFlagged.length,
        withdrawn,
        cleared: stale.length,
        autoWithdrawEnabled: graceDays !== null,
    };
}
