import { Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/email";
import { emailAdmins } from "@/lib/emailRecipients";
import { escapeHtml, baseEmailLayout } from "@/lib/email-templates/base";
import { nextBoundary } from "@/lib/membership/renewal";

/**
 * Staleness notifications — "auto-notifications as things go stale".
 * See docs/designs/STALENESS_NOTIFICATIONS.md.
 *
 * One tiny registry drives two outputs:
 *   - runStalenessNotifications(now): daily household-direct nudges at escalating
 *     thresholds, deduped by the NotificationLedger.
 *   - sendStalenessDigest(now): a weekly board/ops digest of everything currently
 *     stale. No ledger — it is periodic and only describes current state.
 *
 * Adding a fourth type (e.g. background checks — deliberately deferred) is one
 * StaleType appended to `registry`, not a rewrite.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** One aging thing found by a type's `find`. */
export interface StaleItem {
    /** Stable, unique-per-instance id used for dedup, e.g. "renewal:12". */
    subjectKey: string;
    /** The lapse date; null = "no schedule, stale now" (a broken email). */
    dueAt: Date | null;
    /** Household-direct recipients (already resolved to working addresses); may be empty. */
    recipients: string[];
    /** Plain-text line for the board digest (escaped by the runner). */
    digestLine: string;
    /** Household-direct email for the crossed escalation bucket (returns final HTML). */
    email(threshold: number): { subject: string; html: string };
}

/** A registered kind of staleness. */
export interface StaleType {
    /** Ledger discriminator + digest grouping key, e.g. "MEMBERSHIP_RENEWAL". */
    key: string;
    /** Human heading in the digest. */
    label: string;
    /** Descending days-before-lapse to nudge the household at, e.g. [30, 7, 0]. */
    thresholds: number[];
    find(now: Date): Promise<StaleItem[]>;
}

/**
 * The current escalation bucket for an item, or null if it isn't stale yet.
 *
 * The smallest threshold T with daysUntil <= T — so if the cron skipped days and
 * blew past 30 straight to 5, it fires the 7-day stage, not a burst of all three.
 * daysUntil only decreases, so each bucket becomes active at most once.
 * A null dueAt (no schedule, e.g. a broken email) is always bucket 0.
 */
export function activeThreshold(thresholds: number[], dueAt: Date | null, now: Date): number | null {
    if (dueAt === null) return 0;
    const daysUntil = Math.ceil((dueAt.getTime() - now.getTime()) / DAY_MS);
    const entered = thresholds.filter((t) => daysUntil <= t);
    return entered.length ? Math.min(...entered) : null;
}

function daysFromNow(now: Date, days: number): Date {
    return new Date(now.getTime() + days * DAY_MS);
}

/**
 * Household leads with a working (present, not-flagged-undeliverable) address.
 * ponytail: one query per stale item (N+1); fine at cron scale on today's data,
 * batch by householdId if the stale set ever grows large.
 */
async function leadEmails(householdId: number, excludePersonId?: number): Promise<string[]> {
    const leads = await prisma.person.findMany({
        where: {
            householdId,
            isHouseholdLead: true,
            email: { not: null },
            emailUndeliverableAt: null, // never email a known-broken address
            ...(excludePersonId ? { id: { not: excludePersonId } } : {}),
        },
        select: { email: true },
    });
    return leads.map((l) => l.email).filter((e): e is string => !!e);
}

// --- Types -----------------------------------------------------------------

const MEMBERSHIP_THRESHOLDS = [30, 7, 0];

/** An in-flight (incomplete) membership renewal approaching the year boundary. */
const membershipRenewalType: StaleType = {
    key: "MEMBERSHIP_RENEWAL",
    label: "Membership renewals",
    thresholds: MEMBERSHIP_THRESHOLDS,
    async find(now) {
        const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        if (!settings?.orgMembershipYearBoundary) return [];
        const dueAt = nextBoundary(settings.orgMembershipYearBoundary, now);
        // Common boundary → skip the whole scan until it enters the widest window.
        if (dueAt.getTime() - now.getTime() > Math.max(...MEMBERSHIP_THRESHOLDS) * DAY_MS) return [];

        const due = dueAt.toISOString().slice(0, 10);
        const base = config.baseUrl();
        const processes = await prisma.orgMembershipProcess.findMany({
            where: { kind: "RENEWAL", status: { in: ["PENDING_RENEWAL", "RENEWAL_PENDING_BG", "PENDING_PAYMENT"] } },
            select: { id: true, orgMembership: { select: { householdId: true, household: { select: { name: true } } } } },
        });

        const items: StaleItem[] = [];
        for (const p of processes) {
            const householdId = p.orgMembership?.householdId;
            if (!householdId) continue; // a RENEWAL always has a membership; be safe
            items.push({
                subjectKey: `renewal:${p.id}`,
                dueAt,
                recipients: await leadEmails(householdId),
                digestLine: `${p.orgMembership?.household.name ?? `Household ${householdId}`} — renewal due ${due}`,
                email: (t) => ({
                    subject: t <= 0 ? "Your Treehouse membership renewal is overdue" : "Your Treehouse membership renewal is due soon",
                    html: baseEmailLayout(
                        t <= 0
                            ? `<p>Your household membership renewal was due ${due} and is not yet complete. Please finish it: <a href="${base}/membership">${base}/membership</a></p>`
                            : `<p>Your household membership renewal is due by ${due}. Please sign in to complete it: <a href="${base}/membership">${base}/membership</a></p>`,
                    ),
                }),
            });
        }
        return items;
    },
};

const TRUSTED_ADULT_THRESHOLDS = [30, 7];

/**
 * A board-approved trusted adult nearing its one-year `reviewBy`. This replaces
 * the old 30-day warning that lived in runExpirySweep (which now only expires
 * lapsed approvals — the notification moved here, per STALENESS_NOTIFICATIONS.md).
 */
const trustedAdultType: StaleType = {
    key: "TRUSTED_ADULT",
    label: "Trusted adults",
    thresholds: TRUSTED_ADULT_THRESHOLDS,
    async find(now) {
        const base = config.baseUrl();
        const reviews = await prisma.trustedAdultReview.findMany({
            where: {
                status: "APPROVED",
                reviewBy: { not: null, lte: daysFromNow(now, Math.max(...TRUSTED_ADULT_THRESHOLDS)) },
            },
            select: {
                id: true,
                householdId: true,
                reviewBy: true,
                trustedAdult: { select: { trustedAdultName: true, household: { select: { name: true } } } },
            },
        });

        const items: StaleItem[] = [];
        for (const r of reviews) {
            const name = r.trustedAdult.trustedAdultName?.trim() || "a trusted adult";
            const due = r.reviewBy!.toISOString().slice(0, 10);
            items.push({
                subjectKey: `ta-review:${r.id}`,
                dueAt: r.reviewBy,
                recipients: await leadEmails(r.householdId),
                digestLine: `${r.trustedAdult.household.name ?? `Household ${r.householdId}`}: ${name} expires ${due}`,
                email: () => ({
                    subject: "A trusted adult approval is expiring soon",
                    html: baseEmailLayout(
                        `<p>${escapeHtml(name)} is a board-approved trusted adult and expires on ${due}. ` +
                            `You can resubmit it for board review in one click — no need to re-enter anything: ` +
                            `<a href="${base}/trusted-adults">${base}/trusted-adults</a></p>`,
                    ),
                }),
            });
        }
        return items;
    },
};

/**
 * A member whose email address is bouncing (Person.emailUndeliverableAt set). You
 * can't email the broken address, so the household-direct notice goes to the
 * household's OTHER leads with a working address; if there are none, only the
 * digest carries it (recipients empty). The subjectKey embeds the break timestamp
 * so a heal-then-rebreak is a fresh event.
 */
const brokenEmailType: StaleType = {
    key: "BROKEN_EMAIL",
    label: "Broken email addresses",
    thresholds: [0],
    async find() {
        const base = config.baseUrl();
        const broken = await prisma.person.findMany({
            where: { emailUndeliverableAt: { not: null }, email: { not: null } },
            select: {
                id: true,
                name: true,
                email: true,
                householdId: true,
                emailUndeliverableAt: true,
                household: { select: { name: true } },
            },
        });

        const items: StaleItem[] = [];
        for (const p of broken) {
            const who = p.name?.trim() || p.email!;
            items.push({
                subjectKey: `broken-email:${p.id}:${p.emailUndeliverableAt!.getTime()}`,
                dueAt: null,
                recipients: await leadEmails(p.householdId, p.id), // other leads, working addresses only
                digestLine: `${p.household.name ?? `Household ${p.householdId}`}: ${who} <${p.email}> is bouncing`,
                email: () => ({
                    subject: "A member's email address is bouncing",
                    html: baseEmailLayout(
                        `<p>We couldn't deliver email to ${escapeHtml(who)} (${escapeHtml(p.email!)}) in your household — ` +
                            `the address is bouncing, so they aren't getting Treehouse notices. Please help them update it: ` +
                            `<a href="${base}/my-household">${base}/my-household</a></p>`,
                    ),
                }),
            });
        }
        return items;
    },
};

export const registry: StaleType[] = [membershipRenewalType, trustedAdultType, brokenEmailType];

// --- Runners ---------------------------------------------------------------

async function fanOut(recipients: string[], subject: string, html: string): Promise<void> {
    await Promise.all(recipients.map((to) => sendEmail(to, subject, html)));
}

/**
 * Daily household pass. For each stale item in the current escalation window,
 * claim the ledger row (the unique constraint is the dedup guard: a concurrent or
 * retried run loses the insert with P2002 and skips) THEN send. Stamp-then-send
 * mirrors renewalReminderSentAt — a failed email is not retried, avoiding a
 * re-send loop. Returns a per-type {sent, skipped} summary.
 */
export async function runStalenessNotifications(now: Date, types: StaleType[] = registry) {
    const summary: Record<string, { sent: number; skipped: number }> = {};
    for (const type of types) {
        let sent = 0;
        let skipped = 0;
        const items = await type.find(now);
        for (const item of items) {
            const threshold = activeThreshold(type.thresholds, item.dueAt, now);
            if (threshold === null) continue; // not yet in a window
            if (item.recipients.length === 0) { skipped++; continue; } // nobody to email; digest covers it
            try {
                await prisma.notificationLedger.create({ data: { type: type.key, subjectKey: item.subjectKey, threshold } });
            } catch (e) {
                if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") { skipped++; continue; }
                throw e;
            }
            const { subject, html } = item.email(threshold);
            await fanOut(item.recipients, subject, html);
            sent++;
        }
        summary[type.key] = { sent, skipped };
    }
    return summary;
}

/**
 * Weekly board/ops digest of everything currently stale, grouped by type. Sent to
 * the admin list (sysadmins + board, same resolution as reportShopifyFailure). No
 * ledger and no send when nothing is stale.
 */
export async function sendStalenessDigest(now: Date, types: StaleType[] = registry) {
    const counts: Record<string, number> = {};
    const sections: string[] = [];
    for (const type of types) {
        const items = (await type.find(now)).filter((i) => activeThreshold(type.thresholds, i.dueAt, now) !== null);
        counts[type.key] = items.length;
        if (items.length === 0) continue;
        const lis = items.map((i) => `<li>${escapeHtml(i.digestLine)}</li>`).join("");
        sections.push(`<h3>${escapeHtml(type.label)}</h3><ul>${lis}</ul>`);
    }

    if (sections.length === 0) return { sent: false, counts };

    const html = baseEmailLayout(
        `<h2>Weekly staleness digest</h2><p>Things that are currently stale or approaching their deadline:</p>${sections.join("")}`,
    );
    await emailAdmins("Weekly staleness digest", html, "Staleness digest failed:");
    return { sent: true, counts };
}
