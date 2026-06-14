import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * Trusted Adult management.
 *
 * A Trusted Adult is an outside adult a HOUSEHOLD authorizes (e.g. "Grandma can
 * pick up the Smith kids"). Policy refers to these as "dual relationships"; the
 * member-facing name is Trusted Adult. The board reviews each disclosure; a
 * SINGLE board member's decision settles a review (no quorum). Approval is valid
 * for one year — the household leads are warned 30 days out and can resubmit in
 * one click without re-entering anything.
 *
 * Two notes, different audiences:
 *   - familyContext  (on TrustedAdult)        — the family's explanation FOR the
 *       board (what the adult may/may not do). Board + the household only.
 *   - sharedNote     (on TrustedAdultReview)  — the board's note shared OUTWARD on
 *       approval ("Grandma can pick up Bobby"). Required to approve. Seen by the
 *       family, board, the household's program leads, and keyholders.
 *
 * Status machine (TrustedAdultReview.status):
 *   PENDING_BOARD_REVIEW ──► APPROVED | DENIED
 *                        └─► PENDING_SUBJECT_ACTION (board asked for info)
 *   APPROVED ──(reviewBy passes)──► EXPIRED ──(renew)──► new PENDING_BOARD_REVIEW
 *   any non-terminal ──(household withdraws / board override)──► REVOKED
 */

const SYSTEM_ACTOR = 0;
const APPROVAL_VALID_DAYS = 365;
const WARN_LEAD_DAYS = 30;

export class TrustedAdultError extends Error {
    constructor(
        public readonly code:
            | "not_found"
            | "bad_input"
            | "wrong_phase"
            | "forbidden"
            | "already_open",
        message: string,
    ) {
        super(message);
        this.name = "TrustedAdultError";
    }
}

function daysFromNow(base: Date, days: number): Date {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

export interface CreateInput {
    householdId: number;
    counterpartyParticipantId?: number | null;
    counterpartyName: string;
    counterpartyContact: string;
    /** The family's board-facing explanation of what the adult may/may not do. */
    familyContext: string;
    origin?: "SELF_DISCLOSED" | "STAFF_ENTERED";
    disclosedById: number;
}

/**
 * Create a Trusted Adult for a household plus its INITIAL review
 * (PENDING_BOARD_REVIEW). Name, contact, and the family's board-facing context
 * are all required.
 */
export async function createTrustedAdult(input: CreateInput) {
    if (!input.counterpartyName?.trim()) {
        throw new TrustedAdultError("bad_input", "The trusted adult's name is required.");
    }
    if (!input.counterpartyContact?.trim()) {
        throw new TrustedAdultError("bad_input", "Contact info for the trusted adult is required.");
    }
    if (!input.familyContext?.trim()) {
        throw new TrustedAdultError("bad_input", "Tell the board what this adult may or may not do.");
    }

    const household = await prisma.household.findUnique({ where: { id: input.householdId }, select: { id: true } });
    if (!household) throw new TrustedAdultError("not_found", "Household not found.");

    const ta = await prisma.trustedAdult.create({
        data: {
            householdId: input.householdId,
            counterpartyParticipantId: input.counterpartyParticipantId ?? null,
            counterpartyName: input.counterpartyName.trim(),
            counterpartyContact: input.counterpartyContact.trim(),
            familyContext: input.familyContext.trim(),
            origin: input.origin ?? "SELF_DISCLOSED",
            disclosedById: input.disclosedById || SYSTEM_ACTOR,
            reviews: {
                create: { householdId: input.householdId, kind: "INITIAL", status: "PENDING_BOARD_REVIEW" },
            },
        },
        include: { reviews: true },
    });

    await audit(input.disclosedById, ta.id, {}, { created: true, status: "PENDING_BOARD_REVIEW" }, "CREATE");
    await notifyBoard();
    return ta;
}

/**
 * Open a RENEWAL review against an existing Trusted Adult, reusing every fact on
 * file (no re-entry). Allowed only when no review is already in flight. Callable
 * by a lead of the household.
 */
export async function renewTrustedAdult(id: number, actorId: number) {
    const ta = await prisma.trustedAdult.findUnique({
        where: { id },
        include: { reviews: { orderBy: { id: "desc" }, take: 1 } },
    });
    if (!ta) throw new TrustedAdultError("not_found", "Trusted adult not found.");
    await assertHouseholdLead(ta.householdId, actorId);

    const latest = ta.reviews[0];
    if (latest && (latest.status === "PENDING_BOARD_REVIEW" || latest.status === "PENDING_SUBJECT_ACTION")) {
        throw new TrustedAdultError("already_open", "A review for this trusted adult is already in progress.");
    }

    const review = await prisma.trustedAdultReview.create({
        data: { trustedAdultId: ta.id, householdId: ta.householdId, kind: "RENEWAL", status: "PENDING_BOARD_REVIEW" },
    });
    await audit(actorId, ta.id, {}, { renewal: review.id, status: "PENDING_BOARD_REVIEW" }, "CREATE");
    await notifyBoard();
    return review;
}

/** A household lead withdraws a Trusted Adult — sets the latest review REVOKED. */
export async function withdrawTrustedAdult(id: number, actorId: number) {
    const ta = await prisma.trustedAdult.findUnique({
        where: { id },
        include: { reviews: { orderBy: { id: "desc" }, take: 1 } },
    });
    if (!ta) throw new TrustedAdultError("not_found", "Trusted adult not found.");
    await assertHouseholdLead(ta.householdId, actorId);

    const latest = ta.reviews[0];
    if (!latest || latest.status === "REVOKED") throw new TrustedAdultError("wrong_phase", "Nothing to withdraw.");

    const updated = await prisma.trustedAdultReview.update({ where: { id: latest.id }, data: { status: "REVOKED" } });
    await audit(actorId, ta.id, { status: latest.status }, { status: "REVOKED" });
    return updated;
}

export interface DecideInput {
    decision: "APPROVE" | "DENY" | "REQUEST_INFO";
    /** Required on APPROVE: the outward note keyholders & program leads will see. */
    sharedNote?: string | null;
    /** Board-private reasoning (never shown outside the board). */
    note?: string | null;
}

/**
 * A board member decides a review (single entry, no quorum). Acts only on a
 * review awaiting board review.
 *   APPROVE       -> requires sharedNote; stamps effectiveFrom + reviewBy (now + 1yr)
 *   DENY          -> DENIED
 *   REQUEST_INFO  -> PENDING_SUBJECT_ACTION (notify household)
 */
export async function decideReview(reviewId: number, boardMemberId: number, input: DecideInput) {
    const review = await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new TrustedAdultError("not_found", "Review not found.");
    if (review.status !== "PENDING_BOARD_REVIEW") {
        throw new TrustedAdultError("wrong_phase", "This review is not awaiting board review.");
    }
    if (input.decision === "APPROVE" && !input.sharedNote?.trim()) {
        throw new TrustedAdultError(
            "bad_input",
            "A shared note (what keyholders & program leads should know, e.g. who can pick up whom) is required to approve.",
        );
    }

    const now = new Date();
    const data: Record<string, unknown> = {
        decidedById: boardMemberId,
        decision: input.decision,
        decisionNote: input.note?.trim() || null,
    };
    let status: string;
    switch (input.decision) {
        case "APPROVE":
            status = "APPROVED";
            data.effectiveFrom = now;
            data.reviewBy = daysFromNow(now, APPROVAL_VALID_DAYS);
            data.sharedNote = input.sharedNote!.trim();
            break;
        case "DENY":
            status = "DENIED";
            break;
        case "REQUEST_INFO":
            status = "PENDING_SUBJECT_ACTION";
            break;
        default:
            throw new TrustedAdultError("bad_input", "Unknown decision.");
    }
    data.status = status;

    const updated = await prisma.trustedAdultReview.update({ where: { id: reviewId }, data });
    await audit(boardMemberId, review.trustedAdultId, { status: review.status }, { status, decision: input.decision });

    if (input.decision === "REQUEST_INFO") {
        await notifyHouseholdFamily(review.householdId, "The board needs more information about a trusted adult", input.note?.trim());
    }
    return updated;
}

/** Board / sysadmin override: force a review to a terminal state regardless of phase. */
export async function overrideReview(reviewId: number, actorId: number, action: "approve" | "deny" | "revoke", sharedNote?: string | null) {
    const review = await prisma.trustedAdultReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new TrustedAdultError("not_found", "Review not found.");

    const now = new Date();
    const data: Record<string, unknown> = { decidedById: actorId };
    if (action === "approve") {
        if (!sharedNote?.trim()) {
            throw new TrustedAdultError("bad_input", "A shared note is required to force-approve.");
        }
        data.status = "APPROVED";
        data.decision = "APPROVE";
        data.sharedNote = sharedNote.trim();
        data.effectiveFrom = now;
        data.reviewBy = daysFromNow(now, APPROVAL_VALID_DAYS);
    } else if (action === "deny") {
        data.status = "DENIED";
        data.decision = "DENY";
    } else {
        data.status = "REVOKED";
    }

    const updated = await prisma.trustedAdultReview.update({ where: { id: reviewId }, data });
    await audit(actorId, review.trustedAdultId, { status: review.status }, { status: data.status, override: action });
    return updated;
}

/**
 * Nightly sweep: (1) warn the household 30 days before an approval lapses, once;
 * (2) expire approvals whose reviewBy has passed so they re-enter the board queue
 * via a renewal.
 */
export async function runExpirySweep(now: Date) {
    const warnThreshold = daysFromNow(now, WARN_LEAD_DAYS);

    const expiring = await prisma.trustedAdultReview.findMany({
        where: { status: "APPROVED", expiryWarningSentAt: null, reviewBy: { not: null, lte: warnThreshold, gt: now } },
        select: { id: true, trustedAdultId: true, householdId: true, reviewBy: true },
    });
    let warned = 0;
    for (const r of expiring) {
        const due = r.reviewBy ? r.reviewBy.toISOString().slice(0, 10) : "soon";
        await notifyHouseholdFamily(
            r.householdId,
            "A trusted adult approval is expiring soon",
            `This board-approved trusted adult expires on ${due}. You can resubmit it for board review in one click — no need to re-enter anything.`,
        );
        await prisma.trustedAdultReview.update({ where: { id: r.id }, data: { expiryWarningSentAt: now } });
        warned++;
    }

    const lapsed = await prisma.trustedAdultReview.findMany({
        where: { status: "APPROVED", reviewBy: { not: null, lte: now } },
        select: { id: true, trustedAdultId: true, status: true },
    });
    let expired = 0;
    for (const r of lapsed) {
        await prisma.trustedAdultReview.update({ where: { id: r.id }, data: { status: "EXPIRED" } });
        await audit(SYSTEM_ACTOR, r.trustedAdultId, { status: r.status }, { status: "EXPIRED" });
        expired++;
    }

    return { warned, expired };
}

/** Actor must be a lead of the given household. */
export async function assertHouseholdLead(householdId: number, actorId: number) {
    const lead = await prisma.householdLead.findFirst({
        where: { householdId, participantId: actorId },
        select: { participantId: true },
    });
    if (!lead) throw new TrustedAdultError("forbidden", "You must be a lead of this household.");
}

/** Email every board member that a trusted-adult review is waiting. */
async function notifyBoard(): Promise<void> {
    try {
        const board = await prisma.participant.findMany({
            where: { boardMember: true, email: { not: null } },
            select: { email: true },
        });
        const base = process.env.NEXTAUTH_URL ?? "";
        await Promise.all(
            board.map((b) =>
                b.email
                    ? sendEmail(
                          b.email,
                          "Trusted adult: a disclosure needs board review",
                          `<p>A trusted-adult disclosure is awaiting board review. <a href="${base}/admin/trusted-adults">Review it</a>.</p>`,
                      ).catch((e) => logger.error("Board trusted-adult ping failed:", e))
                    : Promise.resolve(),
            ),
        );
    } catch (e) {
        logger.error("notifyBoard failed:", e);
    }
}

/** Email the household's leads (the "family"). */
async function notifyHouseholdFamily(householdId: number, subject: string, body?: string): Promise<void> {
    try {
        const leads = await prisma.householdLead.findMany({
            where: { householdId },
            select: { participant: { select: { email: true } } },
        });
        const base = process.env.NEXTAUTH_URL ?? "";
        const html = `<p>${body ?? ""}</p><p><a href="${base}/trusted-adults">View your trusted adults</a>.</p>`;
        await Promise.all(
            leads
                .map((l) => l.participant?.email)
                .filter((e): e is string => !!e)
                .map((email) => sendEmail(email, subject, html).catch((e) => logger.error("Family trusted-adult ping failed:", e))),
        );
    } catch (e) {
        logger.error("notifyHouseholdFamily failed:", e);
    }
}

function audit(
    actorId: number,
    taId: number,
    oldData: object,
    newData: object,
    action: "CREATE" | "EDIT" = "EDIT",
) {
    return prisma.auditLog.create({
        data: {
            actorId: actorId || SYSTEM_ACTOR,
            action,
            tableName: "TrustedAdult",
            affectedEntityId: taId,
            oldData: JSON.stringify(oldData),
            newData: JSON.stringify(newData),
        },
    });
}
