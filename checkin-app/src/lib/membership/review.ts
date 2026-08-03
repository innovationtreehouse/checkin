import { Prisma, type OrgMembershipProcessStatus } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { emailHouseholdLeads } from "@/lib/emailRecipients";
import { logger } from "@/lib/logger";
import { sendCongrats } from "@/lib/membership/payment";
import { notifyBoardPaidReject } from "@/lib/membership/boardAlerts";
import { config } from "@/lib/config";
import { canonicalizeEmail } from "@/lib/emailNormalize";
import { openPersonBgForNewMember } from "@/lib/membership/personBgTriggers";
import { hasHouseholdConflict, sharesHousehold } from "@/lib/conflictOfInterest";
import { type DbClient, type TxClient } from "@/lib/db-client";
import { awaitingBgReview } from "@/lib/membership/lifecycle";
import { LIVE_PERSON } from "@/lib/person/filters";

/**
 * Background-check review — now a PARALLEL track, not a blocking phase.
 *
 * After intake the application advances to PENDING_PAYMENT regardless of the
 * check; the review happens while the applicant pays. Exception: a household
 * intake note (#900) holds the application at PENDING_BG_REVIEW until the review
 * completes, so a note like "treat us as a volunteer household" can settle dues
 * before payment opens (#907). Two DISTINCT eligible
 * reviewers (role isBackgroundCheckReviewer) must each attest independently. A
 * reviewer may not share a household with the applicant or the other reviewer,
 * and may not attest twice.
 *   - 2 APPROVE  -> clear the check (stamp the named subjects'
 *                  lastBackgroundCheck + sticky volunteer status), then ACTIVATE
 *                  if already paid, else leave at PENDING_PAYMENT for the
 *                  applicant to pay.
 *   - any REJECT -> BLOCKED (membership never activates without a valid check).
 *                  If the household already paid, the board is notified so a
 *                  refund can be handled manually.
 *
 * The system never sees the check itself — only the attestations.
 */

const SYSTEM_ACTOR = 0;
const REQUIRED_APPROVALS = 2;

/**
 * Board members are implicit background-check reviewers (small-org policy):
 * anywhere an explicit reviewer is required — the queue, PII visibility, the
 * attestation, and the reviewer notification — a board member qualifies too.
 * Single source of truth so the API gate, the service, and the UI can't drift.
 */
export function canReviewBackgroundChecks(u: {
    isBackgroundCheckReviewer?: boolean | null;
    isBoardMember?: boolean | null;
}): boolean {
    return Boolean(u.isBackgroundCheckReviewer || u.isBoardMember);
}

export class ReviewError extends Error {
    constructor(
        public readonly code:
            | "not_reviewer"
            | "not_found"
            | "wrong_phase"
            | "same_household_applicant"
            | "same_household_reviewer"
            | "already_attested"
            | "invalid_subject",
        message: string,
    ) {
        super(message);
        this.name = "ReviewError";
    }
}

/**
 * "Awaiting background-check review" now lives as ONE definition — the
 * `awaitingBgReview` StateSet in lib/membership/lifecycle (fix #1). `.has(row)` is
 * the in-tx / client predicate, `.where` the reviewer-queue Prisma fragment; both
 * derive from the same status lists so they can't drift. Formerly three hand-kept
 * encodings (this function, AWAITING_BG_WHERE, applications/page.tsx).
 *
 * A PERSON_BG surfaces in the reviewer queue only once it's been SUBMITTED — i.e.
 * bgConsentAt is set (the board recorded that an external check exists via
 * submitPersonBgForReview). This mirrors how the household parallel track gates on
 * bgConsentAt in awaitingBgReview.where. An unsubmitted PERSON_BG (bgConsentAt ==
 * null) stays out: not listed, not counted, no reviewer ping — its subject isn't
 * ready to approve yet, and the queue GET now renders the subject once it is. A
 * single `NOT` key so it spreads cleanly alongside awaitingBgReview.where's own
 * `OR` (two spread objects sharing an `OR` key would clobber it).
 */
const QUEUE_EXCLUDES_UNSUBMITTED_PERSON_BG: Prisma.OrgMembershipProcessWhereInput = {
    NOT: { kind: "PERSON_BG", bgConsentAt: null },
};

/** Email every background-check reviewer that an application awaits review. */
export async function notifyReviewers(): Promise<void> {
    try {
        const reviewers = await prisma.person.findMany({
            where: { email: { not: null }, OR: [{ isBackgroundCheckReviewer: true }, { isBoardMember: true }], ...LIVE_PERSON },
            select: { email: true },
        });
        const base = config.baseUrl();
        await Promise.all(
            reviewers.map((r) =>
                r.email
                    // sendEmail never rejects (resolves false + logs via logIntegrationError
                    // on failure) — nothing here for a .catch to ever reach.
                    ? sendEmail(
                          r.email,
                          "Membership: a background-check review is needed",
                          `<p>An application is ready for your background-check review. Please sign in to review it: <a href="${base}/membership-ops/review">${base}/membership-ops/review</a></p>`,
                      )
                    : Promise.resolve(),
            ),
        );
    } catch (e) {
        logger.error("notifyReviewers failed:", e);
    }
}

async function loadReviewer(reviewerId: number) {
    return prisma.person.findUnique({ where: { id: reviewerId }, select: { id: true, householdId: true, isBackgroundCheckReviewer: true, isBoardMember: true } });
}

/**
 * The household the review's "applicant" belongs to, used for the same-household
 * reviewer-exclusion. For a PERSON_BG the applicant is the SUBJECT person; for a
 * household INITIAL/RENEWAL it's the membership's household. Null when neither is
 * resolvable (e.g. a PERSON_BG whose subject has no household to exclude) — the
 * caller then applies no exclusion.
 */
async function applicantHousehold(db: DbClient, process: { orgMembershipId: number | null; subjectPersonId: number | null }): Promise<number | null> {
    if (process.subjectPersonId) {
        const p = await db.person.findUnique({ where: { id: process.subjectPersonId }, select: { householdId: true } });
        return p?.householdId ?? null;
    }
    if (process.orgMembershipId) {
        const m = await db.orgMembership.findUnique({ where: { id: process.orgMembershipId }, select: { householdId: true } });
        return m?.householdId ?? null;
    }
    return null;
}

/**
 * The adults a household review may name as check subjects: the applicant
 * household's live leads. A PERSON_BG names its subject on the process itself and
 * has none.
 */
async function liveHouseholdLeadIds(db: DbClient, householdId: number | null): Promise<number[]> {
    if (householdId === null) return [];
    const leads = await db.person.findMany({ where: { householdId, isHouseholdLead: true, ...LIVE_PERSON }, select: { id: true } });
    return leads.map((l) => l.id);
}

/**
 * Subject ids off a request body, reduced to plausible ids. Junk becomes an empty
 * list rather than a 500, and the service then rejects it as an unnamed approval —
 * the same 400 as sending nothing.
 */
export function subjectIds(raw: unknown): number[] | undefined {
    if (!Array.isArray(raw)) return undefined;
    return raw.filter((v): v is number => Number.isInteger(v) && v > 0);
}

/**
 * The adults a household process has cleared: those two reviewers both named.
 * A subject-less attestation (a REJECT, a PERSON_BG, or a legacy row attested
 * before per-adult subjects existed) names nobody and counts toward no one.
 */
export function subjectsWithTwoApprovals(attestations: { result: string; subjectPersonId: number | null }[]): number[] {
    const approvals = new Map<number, number>();
    for (const a of attestations) {
        if (a.result !== "APPROVE" || a.subjectPersonId === null) continue;
        approvals.set(a.subjectPersonId, (approvals.get(a.subjectPersonId) ?? 0) + 1);
    }
    return [...approvals].filter(([, n]) => n >= REQUIRED_APPROVALS).map(([id]) => id);
}

/**
 * IDs of the applications this reviewer may currently attest (eligibility
 * filtered: not their own household, subjects still outstanding for them, no
 * household-mate already on it). The route turns these into model rows for the
 * stripper; the notifications endpoint just counts them.
 *
 * Eligibility is PER-SUBJECT on a household process: a reviewer who named Alex but
 * not Sam still has Sam to attest, so the application stays in their queue. It
 * leaves when they have named every live lead — or when the check clears, which
 * drops it from awaitingBgReview outright.
 */
export async function eligibleReviewProcessIds(reviewerId: number): Promise<number[]> {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer || !canReviewBackgroundChecks(reviewer)) return [];

    const processes = await prisma.orgMembershipProcess.findMany({
        where: { ...awaitingBgReview.where, ...QUEUE_EXCLUDES_UNSUBMITTED_PERSON_BG },
        orderBy: { stageEnteredAt: "asc" },
        select: {
            id: true,
            subjectPersonId: true,
            orgMembership: {
                select: {
                    householdId: true,
                    household: { select: { householdMembers: { where: { isHouseholdLead: true, ...LIVE_PERSON }, select: { id: true } } } },
                },
            },
            subjectPerson: { select: { householdId: true } },
            attestations: { select: { reviewerId: true, subjectPersonId: true, reviewer: { select: { householdId: true } } } },
        },
    });

    return processes
        .filter((p) => {
            // Applicant household = subject's for a PERSON_BG, else the membership's.
            const applicantHouseholdId = p.subjectPerson?.householdId ?? p.orgMembership?.householdId ?? null;
            if (sharesHousehold(reviewer.householdId, applicantHouseholdId)) return false; // own household
            const mine = p.attestations.filter((a) => a.reviewerId === reviewer.id);
            const others = p.attestations.filter((a) => a.reviewerId !== reviewer.id);
            if (others.some((a) => sharesHousehold(reviewer.householdId, a.reviewer.householdId))) return false; // shares household with other reviewer
            // A PERSON_BG is one attestation per reviewer; a household one is one per lead.
            if (p.subjectPersonId) return mine.length === 0;
            const named = new Set(mine.map((a) => a.subjectPersonId));
            const leads = p.orgMembership?.household?.householdMembers ?? [];
            // A household with no live lead has nobody to name, so there is nothing this
            // reviewer can attest; it stays visible to the board on the applications view.
            return leads.some((l) => !named.has(l.id));
        })
        .map((p) => p.id);
}

/**
 * Reviewer-scoped badge counts for the Review tab / nav:
 *   - canActOn: applications this reviewer may attest right now (green).
 *   - approvedAwaitingSecond: applications this reviewer already approved that
 *     still await a second reviewer (gray). An awaiting process only ever holds
 *     APPROVE attestations and needs 2 to clear on some subject, so "attested by
 *     me and nothing left for me to name" == "approved by me, not yet done".
 *     Excluding canActOn matters now that a half-named household stays actionable:
 *     without it the same row would be counted green AND gray.
 */
export async function reviewQueueCounts(reviewerId: number): Promise<{ canActOn: number; approvedAwaitingSecond: number }> {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer || !canReviewBackgroundChecks(reviewer)) return { canActOn: 0, approvedAwaitingSecond: 0 };
    const canActOnIds = await eligibleReviewProcessIds(reviewerId);
    const approvedAwaitingSecond = await prisma.orgMembershipProcess.count({
        where: { ...awaitingBgReview.where, ...QUEUE_EXCLUDES_UNSUBMITTED_PERSON_BG, attestations: { some: { reviewerId } }, id: { notIn: canActOnIds } },
    });
    return { canActOn: canActOnIds.length, approvedAwaitingSecond };
}

/**
 * Record a reviewer's attestation. Validates eligibility, then on REJECT blocks
 * the application and on the 2nd APPROVE of a named subject clears the check —
 * activating the membership if dues are already paid, else leaving it at
 * PENDING_PAYMENT.
 *
 * `subjectPersonIds` names the adults whose Averity reports this reviewer read;
 * approving a household without naming anyone is rejected, not silently accepted.
 * One row is written per named subject, so a reviewer holding two reports on one
 * family records both in a single click.
 */
export async function attest(
    reviewerId: number,
    processId: number,
    input: { result: "APPROVE" | "REJECT"; isMarkedVolunteer?: boolean; note?: string; subjectPersonIds?: number[] },
) {
    const reviewer = await loadReviewer(reviewerId);
    if (!reviewer || !canReviewBackgroundChecks(reviewer)) throw new ReviewError("not_reviewer", "You are not a background-check reviewer.");

    // Re-check eligibility, create the attestation, recompute approvals, and converge
    // all inside one transaction. FOR UPDATE on the OrgMembershipProcess row serializes
    // concurrent attestations AND the payment path (payment.ts › activate takes the
    // same lock) — so the payment/clearance race can't lose an update: whoever commits
    // second sees the other's field set and flips ACTIVE. Mirrors leads.ts.
    type AttestOutcome =
        | { status: "BLOCKED"; notifyPaidReject: boolean }
        | { status: OrgMembershipProcessStatus; activated: boolean; householdId: number | null; isInitial: boolean }
        | { status: OrgMembershipProcessStatus; approvals: number };
    const result = await prisma.$transaction<AttestOutcome>(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OrgMembershipProcess" WHERE id = ${processId} FOR UPDATE`;

        const process = await tx.orgMembershipProcess.findUnique({
            where: { id: processId },
            include: { attestations: { include: { reviewer: { select: { householdId: true } } } } },
        });
        if (!process) throw new ReviewError("not_found", "Application not found.");
        if (!awaitingBgReview.has({ status: process.status, bgConsentAt: !!process.bgConsentAt, bgClearedAt: !!process.bgClearedAt })) throw new ReviewError("wrong_phase", "This application is not awaiting background-check review.");
        const applicantHouseholdId = await applicantHousehold(tx, process);
        if (sharesHousehold(reviewer.householdId, applicantHouseholdId)) throw new ReviewError("same_household_applicant", "You cannot review an applicant in your own household.");
        const mine = process.attestations.filter((a) => a.reviewerId === reviewerId);
        const others = process.attestations.filter((a) => a.reviewerId !== reviewerId);
        if (others.some((a) => sharesHousehold(reviewer.householdId, a.reviewer.householdId))) throw new ReviewError("same_household_reviewer", "Another reviewer from your household has already reviewed this application.");

        // Which adults this attestation covers. A REJECT is whole-process and a
        // PERSON_BG already names its subject on the process, so both record one
        // subject-less row; only a household APPROVE names people.
        const isHousehold = !process.subjectPersonId;
        let subjects: (number | null)[] = [null];
        if (isHousehold && input.result === "APPROVE") {
            const requested = [...new Set(input.subjectPersonIds ?? [])];
            if (!requested.length) throw new ReviewError("invalid_subject", "Say whose background check you reviewed.");
            const candidates = new Set(await liveHouseholdLeadIds(tx, applicantHouseholdId));
            if (requested.some((id) => !candidates.has(id))) throw new ReviewError("invalid_subject", "That person is not a household lead on this application.");
            if (requested.some((id) => mine.some((a) => a.subjectPersonId === id))) throw new ReviewError("already_attested", "You have already reviewed this application for that person.");
            subjects = requested;
        } else if (mine.some((a) => a.subjectPersonId === null)) {
            throw new ReviewError("already_attested", "You have already reviewed this application.");
        }

        await tx.backgroundCheckAttestation.createMany({
            data: subjects.map((subjectPersonId) => ({ processId, reviewerId, subjectPersonId, result: input.result, isMarkedVolunteer: !!input.isMarkedVolunteer, note: input.note ?? null })),
        });

        if (input.result === "REJECT") {
            await tx.orgMembershipProcess.update({ where: { id: processId }, data: { status: "BLOCKED", stageEnteredAt: new Date() } });
            await audit(tx, reviewerId, processId, { status: process.status }, { status: "BLOCKED", reason: "reviewer reject", ...(input.note ? { note: input.note } : {}) });
            // A paid household that fails review needs a manual refund — flag the board (post-tx).
            return { status: "BLOCKED" as const, notifyPaidReject: !!process.paidAt };
        }

        const withThis = [...process.attestations, ...subjects.map((subjectPersonId) => ({ result: "APPROVE", subjectPersonId }))];
        const approvals = withThis.filter((a) => a.result === "APPROVE").length;
        // A household clears when SOME named adult reaches two approvals (one checked
        // adult satisfies membership); a PERSON_BG counts the process as it always has.
        const clears = isHousehold ? subjectsWithTwoApprovals(withThis).length > 0 : approvals >= REQUIRED_APPROVALS;
        if (clears) {
            const { activated, householdId, isInitial } = await clearBackgroundCheck(tx, processId, reviewerId);
            // A cleared PERSON_BG resolves to ACTIVE too; only a household process
            // gates on the PENDING_PAYMENT convergence.
            const status: OrgMembershipProcessStatus = activated ? "ACTIVE" : process.subjectPersonId ? "ACTIVE" : "PENDING_PAYMENT";
            return { status, activated, householdId, isInitial };
        }
        return { status: process.status, approvals };
    });

    // Side effects outside the transaction (a slow/failed send must not roll it back).
    if ("activated" in result) {
        if (result.activated) {
            await sendCongrats(result.householdId!, result.isInitial);
            // Trigger C: a brand-new (INITIAL) member just activated — open PERSON_BG
            // for any program-attached ≥18 person in the household (as-of activation).
            if (result.isInitial) await openPersonBgForNewMember(result.householdId!, new Date());
        } else if (result.householdId) {
            // Household process cleared into PENDING_PAYMENT (a PERSON_BG has no
            // household/payment) — tell the family payment is open (#907).
            await notifyPaymentOpen(result.householdId);
        }
    }
    if ("notifyPaidReject" in result && result.notifyPaidReject) await notifyBoardPaidReject(processId);

    if ("approvals" in result) return { status: result.status, approvals: result.approvals };
    return { status: result.status };
}

/**
 * The background check is satisfied (2 approvals on some subject, or a board
 * override). Stamp the named subjects' lastBackgroundCheck + sticky volunteer
 * status + bgClearedAt, then converge on the two-track gate:
 *   - already paid -> ACTIVE (payment finished first)
 *   - not yet paid -> PENDING_PAYMENT (applicant still needs to pay)
 * Returns whether it activated + householdId so the caller can send congrats.
 * Must run inside a tx holding a FOR UPDATE lock on the process row.
 *
 * `subjectOverride` is the board force-approve, which asserts its subjects rather
 * than counting attestations — a BLOCKED process carries at most one APPROVE per
 * subject, so counting there always yields nobody.
 */
async function clearBackgroundCheck(tx: TxClient, processId: number, actorId: number, subjectOverride?: number[]): Promise<{ activated: boolean; householdId: number | null; isInitial: boolean }> {
    const process = await tx.orgMembershipProcess.findUnique({
        where: { id: processId },
        include: { attestations: true },
    });
    if (!process) throw new ReviewError("not_found", "Application not found.");

    // PERSON_BG: subject-scoped. Stamp ONLY the subject person and resolve — there is
    // no household membership to activate/pay, so skip the payment/activation
    // convergence entirely, and do NOT touch the household-lead blanket stamp (that's
    // the household path below, whose lead-stamp change is Phase 5).
    if (process.subjectPersonId) {
        const now = new Date();
        await tx.person.update({ where: { id: process.subjectPersonId }, data: { lastBackgroundCheck: now } });
        await tx.orgMembershipProcess.update({ where: { id: processId }, data: { bgClearedAt: now, status: "ACTIVE", stageEnteredAt: now } });
        await audit(tx, actorId, processId, { status: process.status }, { status: "ACTIVE", bgCleared: true, subjectPersonId: process.subjectPersonId });
        return { activated: false, householdId: null, isInitial: false };
    }

    // Household INITIAL/RENEWAL path (unchanged): orgMembershipId is always set here.
    const membership = await tx.orgMembership.findUnique({ where: { id: process.orgMembershipId! }, select: { householdId: true } });
    if (!membership) throw new ReviewError("not_found", "Membership not found.");
    const householdId = membership.householdId;
    const now = new Date();
    const paid = !!process.paidAt;

    // Stamp only the adults this review actually covered — the subjects the reviewers
    // read off the Averity reports. A legacy process names nobody and so stamps nobody:
    // better a household that reads stale than another unchecked adult marked cleared.
    // Expiry is derived from this plus BoardSettings.bgRecheckMonths at read time (see
    // householdBgIsFresh) — not stored.
    const cleared = subjectOverride ?? subjectsWithTwoApprovals(process.attestations);
    if (cleared.length) {
        await tx.person.updateMany({ where: { id: { in: cleared } }, data: { lastBackgroundCheck: now } });
    }
    await applyVolunteerStatus(tx, process.orgMembershipId!, householdId, process.attestations.some((a) => a.isMarkedVolunteer));

    await tx.orgMembershipProcess.update({
        where: { id: processId },
        data: { bgClearedAt: now, status: paid ? "ACTIVE" : "PENDING_PAYMENT", stageEnteredAt: now },
    });
    if (paid) {
        await tx.orgMembership.update({ where: { id: process.orgMembershipId! }, data: { status: "ACTIVE" } });
    }

    await audit(tx, actorId, processId, { status: process.status }, { status: paid ? "ACTIVE" : "PENDING_PAYMENT", bgCleared: true, clearedPersonIds: cleared });
    return { activated: paid, householdId, isInitial: process.kind === "INITIAL" };
}

/**
 * True if any household-lead email matches any volunteer-designation email, under
 * the shared Gmail/+tag-aware canonicalization. Extracted (pure) so the money-path
 * match rule is unit-testable without a DB. DRIVES DUES via isVolunteer.
 */
export function matchesVolunteerDesignation(parentEmails: string[], designationEmails: string[]): boolean {
    const parents = new Set(parentEmails.map(canonicalizeEmail));
    if (!parents.size) return false;
    return designationEmails.some((d) => parents.has(canonicalizeEmail(d)));
}

/**
 * Sticky/additive volunteer status: set Membership.isVolunteer = true if ANY
 * reviewer marked the family volunteer-only OR a household parent's email is pre-
 * designated. Never clears it here. Runs at every PENDING_PAYMENT transition
 * (external advance, fresh-check intake shortcut, fresh-check renewal) so the
 * allowlist drives dues BEFORE the check clears (#874), and again at clearance
 * with the reviewers' volunteer marks.
 */
export async function applyVolunteerStatus(db: DbClient, orgMembershipId: number, householdId: number, markedByReviewer: boolean) {
    let isVolunteer = markedByReviewer;
    if (!isVolunteer) {
        const parents = await db.person.findMany({ where: { householdId, isHouseholdLead: true, email: { not: null }, ...LIVE_PERSON }, select: { email: true } });
        const designations = await db.volunteerDesignation.findMany({ select: { email: true } });
        isVolunteer = matchesVolunteerDesignation(parents.map((p) => p.email!), designations.map((d) => d.email));
    }
    if (isVolunteer) {
        await db.orgMembership.update({ where: { id: orgMembershipId }, data: { isVolunteer: true } });
    }
}

/**
 * Board action on a background-check review: `reset` returns it to neutral (zero
 * attestations, ready for re-review), `approve` force-clears a BLOCKED one.
 *
 * `reset` reaches a review that is BLOCKED **or** still in progress — an
 * accidental first approval is the same "restart this review" as a board reset,
 * so both share one definition. A review that has already CLEARED is out of
 * reach: its side effects (the guardians' lastBackgroundCheck stamp, activation,
 * the opened PERSON_BG rows, the sent mail) have already fanned out, and
 * deleting the attestations would leave a cleared row with nothing behind it.
 * `approve` stays BLOCKED-only — force-clearing a review still open to its
 * second reviewer is what the two-reviewer rule forbids.
 *
 * A household `approve` must name its subjects. A BLOCKED process carries at most
 * one APPROVE per subject — a second would already have cleared it — so counting
 * attestations here can never reach two, and an unnamed override would set
 * bgClearedAt with no adult behind it.
 */
export async function overrideBlocked(processId: number, actorId: number, action: "reset" | "approve", subjectPersonIds?: number[]) {
    const process = await prisma.orgMembershipProcess.findUnique({
        where: { id: processId },
        include: { orgMembership: { select: { household: { select: { intakeNotes: true } } } } },
    });
    if (!process) throw new ReviewError("not_found", "Application not found.");
    if (action === "approve" && process.status !== "BLOCKED") throw new ReviewError("wrong_phase", "This application is not blocked.");

    // Conflict of interest: no actor may override their OWN household's blocked
    // application — else they could force-clear their family's failed background check, the
    // very thing attest()'s same-household gate forbids. No role bypasses this.
    const applicantHouseholdId = await applicantHousehold(prisma, process);
    if (await hasHouseholdConflict(prisma, actorId, applicantHouseholdId)) {
        throw new ReviewError("same_household_applicant", "You cannot override your own household's application — someone outside your household must.");
    }

    if (action === "reset") {
        const status = await prisma.$transaction(async (tx) => {
            // FOR UPDATE per attest()'s contract: without it a concurrent second
            // attestation could clear the check between the phase test and the delete,
            // leaving a cleared process with no attestations behind it.
            await tx.$queryRaw`SELECT id FROM "OrgMembershipProcess" WHERE id = ${processId} FOR UPDATE`;
            const fresh = await tx.orgMembershipProcess.findUnique({ where: { id: processId }, select: { status: true, bgConsentAt: true, bgClearedAt: true } });
            if (!fresh) throw new ReviewError("not_found", "Application not found.");
            const blocked = fresh.status === "BLOCKED";
            if (!blocked && !awaitingBgReview.has({ status: fresh.status, bgConsentAt: !!fresh.bgConsentAt, bgClearedAt: !!fresh.bgClearedAt })) {
                throw new ReviewError("wrong_phase", "This background-check review is neither blocked nor still in progress.");
            }
            // A blocked application resumes at the review status its cycle calls for; one
            // still in review already sits there, so only its attestations go.
            const reviewStatus = blocked ? blockedResetStatus(process) : fresh.status;
            await tx.backgroundCheckAttestation.deleteMany({ where: { processId } });
            await tx.orgMembershipProcess.update({ where: { id: processId }, data: { status: reviewStatus, bgClearedAt: null, stageEnteredAt: new Date() } });
            await audit(tx, actorId, processId, { status: fresh.status }, { status: reviewStatus, action: "board reset" });
            return reviewStatus;
        });
        await notifyReviewers();
        return { status };
    }

    let subjectOverride: number[] | undefined;
    if (!process.subjectPersonId) {
        const requested = [...new Set(subjectPersonIds ?? [])];
        if (!requested.length) throw new ReviewError("invalid_subject", "Say whose background check this override covers.");
        const candidates = new Set(await liveHouseholdLeadIds(prisma, applicantHouseholdId));
        if (requested.some((id) => !candidates.has(id))) throw new ReviewError("invalid_subject", "That person is not a household lead on this application.");
        subjectOverride = requested;
    }

    // FOR UPDATE per clearBackgroundCheck's contract: serializes a board approve
    // against a late payment webhook (activate also locks), so the override reads
    // a fresh paidAt and converges to ACTIVE rather than parking it at PENDING_PAYMENT.
    const { activated, householdId, isInitial } = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OrgMembershipProcess" WHERE id = ${processId} FOR UPDATE`;
        return clearBackgroundCheck(tx, processId, actorId, subjectOverride);
    });
    if (activated) {
        await sendCongrats(householdId!, isInitial);
        // Trigger C: a board force-clear can be the first activation of a brand-new
        // (INITIAL) member — open PERSON_BG for the household's program-attached adults.
        if (isInitial) await openPersonBgForNewMember(householdId!, new Date());
    } else if (householdId) {
        // Household process cleared into PENDING_PAYMENT — payment just opened (#907).
        await notifyPaymentOpen(householdId);
    }
    // A cleared PERSON_BG resolves to ACTIVE; a household process gates on PENDING_PAYMENT.
    const status: OrgMembershipProcessStatus = activated ? "ACTIVE" : process.subjectPersonId ? "ACTIVE" : "PENDING_PAYMENT";
    return { status };
}

type BlockedResetRow = {
    kind: string;
    bgConsentAt: Date | null;
    paidAt: Date | null;
    orgMembership: { household: { intakeNotes: string | null } } | null;
};

/**
 * The review status a BLOCKED application resumes at when the board resets it.
 * The check runs in parallel, so a household process returns to
 * PENDING_BG_CLEARANCE if it had already paid, else PENDING_PAYMENT. An unpaid one
 * with a household intake note re-holds at PENDING_BG_REVIEW — the reset restarts
 * review, and a note keeps payment gated on it (#907). Renewals follow the same
 * household path, except one blocked BEFORE consent was recorded (only legacy
 * RENEWAL_PENDING_BG rows — every current renewal path records consent before
 * review can block) restarts at the external step itself: the parallel queue only
 * lists PENDING_PAYMENT/PENDING_BG_CLEARANCE rows WITH consent, so parking an
 * unconsented renewal there would strand it.
 */
function blockedResetStatus(process: BlockedResetRow): OrgMembershipProcessStatus {
    return process.kind === "PERSON_BG" ? "PENDING_BG_REVIEW"
        : process.kind === "RENEWAL" && !process.bgConsentAt ? "PENDING_EXTERNAL_ACTION"
        : process.paidAt ? "PENDING_BG_CLEARANCE"
        : process.orgMembership?.household.intakeNotes?.trim() ? "PENDING_BG_REVIEW"
        : "PENDING_PAYMENT";
}

/**
 * The check cleared but dues aren't paid — the process just (re)entered
 * PENDING_PAYMENT. For an application that was held for review (intake note,
 * renewal re-check) this is the moment payment first opens, and the status
 * cards/banner promise an email at clearance. Best-effort (send failures log).
 */
async function notifyPaymentOpen(householdId: number) {
    const base = config.baseUrl();
    await emailHouseholdLeads(
        householdId,
        "Background check complete — you can now pay your membership dues",
        `<p>Good news — your household's background-check review is complete. The last step is paying your membership dues: <a href="${base}/membership">${base}/membership</a></p>`,
        "Payment-open notice failed:",
    );
}

function audit(db: DbClient, actorId: number, processId: number, oldData: object, newData: object) {
    return db.auditLog.create({
        data: {
            actorId: actorId || SYSTEM_ACTOR,
            action: "EDIT",
            tableName: "OrgMembershipProcess",
            affectedEntityId: processId,
            oldData,
            newData,
        },
    });
}
