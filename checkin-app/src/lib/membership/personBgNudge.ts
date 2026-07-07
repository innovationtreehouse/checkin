import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";
import { baseEmailLayout } from "@/lib/email-templates/base";
import { backgroundCheckProvider } from "@/lib/membership/background-check/manual-adapter";
import { bgFreshThreshold, personBgVerdict } from "@/lib/membership/personBgCheck";
import { nextBoundary } from "@/lib/membership/renewal";

/**
 * Escalating background-check NUDGES toward the 18+ program student who has an open
 * PERSON_BG obligation (opened by cron/person-bg-annual). Warn-only: this NEVER
 * blocks check-in/enrollment (rejected alternative — see docs/designs/BG_STUDENT_NUDGES.md).
 *
 * The email carries the Averity consent deep link and points at the self-attest
 * path (#875) for after they've submitted. Recipients mirror the existing
 * trusted-adult notifications (emailHouseholdLeads) PLUS the student themselves when
 * they have an email on file.
 *
 * Dedup: a PersonBgNudge row per (obligation, threshold) — inserted BEFORE the send,
 * so repeated daily runs never re-send the same threshold for the same obligation.
 * Clearing needs no signal here: a cleared/submitted obligation simply drops out of
 * the open-and-still-NEEDED set below, so nudges stop naturally.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Which nudge threshold (obligation age in whole days) is DUE for an obligation of
 * age `ageDays`: 0 on open, then +14d, +30d, then monthly (60, 90, ...). Returns the
 * largest threshold reached, or null before the obligation exists (negative age).
 *
 * The sequence is monotonic, so each run only ever records a threshold ≥ the last —
 * the (processId, thresholdDay) unique index then blocks a re-send at the same stage.
 */
export function dueThresholdDay(ageDays: number): number | null {
    if (ageDays < 0) return null;
    if (ageDays < 14) return 0;
    if (ageDays < 30) return 14;
    return 30 * Math.floor(ageDays / 30); // 30, 60, 90, ... — monthly after the first month
}

/** The nudge email (one static Averity link + the self-attest page; neither is user-controlled). */
function nudgeEmail(deepLink: string | null): { subject: string; html: string } {
    const selfAttest = `${config.baseUrl()}/membership`;
    const consentLine = deepLink
        ? `<p><a href="${deepLink}">Start your background check on Averity</a> — it only takes a few minutes.</p>`
        : "";
    const html = baseEmailLayout(`
        <h2 style="margin: 0 0 12px;">Action needed: background check</h2>
        <p>A yearly background check is needed for an adult in your household who takes part in our programs.</p>
        ${consentLine}
        <p>Already submitted on Averity? <a href="${selfAttest}">Confirm it here</a> so we can finish the review.</p>
    `);
    return { subject: "Please complete your background check", html };
}

/**
 * Send one nudge to the student's household: every household lead + the student
 * themselves (deduped). Best-effort — sendEmail never rejects; a stray query error
 * is logged and swallowed so one bad obligation can't abort the sweep.
 */
async function sendNudge(
    person: { id: number; householdId: number | null; email: string | null },
    email: { subject: string; html: string },
): Promise<void> {
    try {
        const recipients = new Set<string>();
        if (person.householdId) {
            const leads = await prisma.person.findMany({
                where: { householdId: person.householdId, isHouseholdLead: true },
                select: { email: true },
            });
            for (const l of leads) if (l.email) recipients.add(l.email);
        }
        if (person.email) recipients.add(person.email);
        await Promise.all([...recipients].map((to) => sendEmail(to, email.subject, email.html)));
    } catch (e) {
        logger.error("Person-BG nudge send failed:", e);
    }
}

/**
 * Nightly sweep. For every OPEN PERSON_BG obligation still awaiting the student
 * (PENDING_BG_REVIEW, not yet consented) whose subject is STILL background-check
 * NEEDED, send the due escalating nudge once. No-op unless bgRecheckMonths and the
 * membership-year boundary are configured (same gate as person-bg-annual).
 *
 * The still-NEEDED re-check mirrors person-bg-annual eligibility EXACTLY, so a person
 * cleared out-of-band (e.g. the household blanket-stamp stamps a lead's
 * lastBackgroundCheck) drops out here even before their lingering obligation closes —
 * "a cleared person gets nothing".
 */
export async function runPersonBgNudgeSweep(now: Date) {
    const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
    const months = settings?.bgRecheckMonths ?? 0;
    if (months <= 0) return { nudged: 0, reason: "bgRecheckMonths not configured" };
    if (!settings?.orgMembershipYearBoundary) return { nudged: 0, reason: "no membership-year boundary configured" };

    const boundary = nextBoundary(settings.orgMembershipYearBoundary, now);
    const threshold = bgFreshThreshold(boundary, months);

    // Open obligation = the student hasn't submitted yet (bgConsentAt null). Once they
    // self-attest or the check clears, the row leaves this set and nudges stop.
    const open = await prisma.orgMembershipProcess.findMany({
        where: { kind: "PERSON_BG", status: "PENDING_BG_REVIEW", bgConsentAt: null, subjectPersonId: { not: null } },
        select: {
            id: true,
            createdAt: true,
            subjectPerson: {
                select: { id: true, householdId: true, email: true, dateOfBirth: true, isDeclaredAdult: true, lastBackgroundCheck: true },
            },
        },
    });

    const deepLink = await backgroundCheckProvider.getConsentDeepLink();
    const email = nudgeEmail(deepLink);

    let nudged = 0;
    for (const p of open) {
        const person = p.subjectPerson;
        if (!person) continue;
        if (personBgVerdict(person, boundary, threshold) !== "NEEDED") continue;

        const stage = dueThresholdDay(Math.floor((now.getTime() - p.createdAt.getTime()) / DAY_MS));
        if (stage === null) continue;

        // Record-before-send: the unique index makes a second run at the same stage a
        // no-op (count 0 → skip). ponytail: a rare Resend failure after the insert loses
        // that one nudge rather than risking a duplicate — the next stage still fires.
        const { count } = await prisma.personBgNudge.createMany({
            data: [{ processId: p.id, thresholdDay: stage }],
            skipDuplicates: true,
        });
        if (count === 0) continue;

        await sendNudge(person, email);
        nudged++;
    }
    return { nudged };
}
