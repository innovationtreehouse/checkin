import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * Dual Relationship Management (Safety Links).
 *
 * A subject (always a Participant — member or visitor) discloses an external
 * relationship with a counterparty (another Participant, or someone outside the
 * org). The board reviews each disclosure; a SINGLE board member's decision
 * settles a review (no quorum). An approval is valid for one year — the family
 * (subject's household leads) is warned 30 days out and can resubmit in one click
 * without re-entering anything, because the durable facts live on the SafetyLink
 * and each cycle is a fresh SafetyLinkReview row.
 *
 * Status machine (SafetyLinkReview.status):
 *   PENDING_BOARD_REVIEW ──► APPROVED | APPROVED_WITH_CONDITIONS | DENIED
 *                        └─► PENDING_SUBJECT_ACTION (board asked for info)
 *   APPROVED* ──(reviewBy passes)──► EXPIRED ──(renew)──► new PENDING_BOARD_REVIEW
 *   any non-terminal ──(subject withdraws / board override)──► REVOKED
 */

const SYSTEM_ACTOR = 0;
const APPROVAL_VALID_DAYS = 365;
const WARN_LEAD_DAYS = 30;

export type RelationshipType =
    | "FAMILY"
    | "GUARDIAN"
    | "HOUSEHOLD"
    | "ROMANTIC"
    | "FORMER_PROFESSIONAL"
    | "FINANCIAL"
    | "LEGAL_RESTRICTION"
    | "OTHER";

const RELATIONSHIP_TYPES = new Set<RelationshipType>([
    "FAMILY",
    "GUARDIAN",
    "HOUSEHOLD",
    "ROMANTIC",
    "FORMER_PROFESSIONAL",
    "FINANCIAL",
    "LEGAL_RESTRICTION",
    "OTHER",
]);

export class SafetyLinkError extends Error {
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
        this.name = "SafetyLinkError";
    }
}

function daysFromNow(base: Date, days: number): Date {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

export interface CreateInput {
    subjectParticipantId: number;
    counterpartyParticipantId?: number | null;
    counterpartyName?: string | null;
    counterpartyContact?: string | null;
    relationshipType: string;
    description: string;
    origin?: "SELF_DISCLOSED" | "STAFF_ENTERED";
    disclosedById: number;
}

/**
 * Create a new Safety Link plus its INITIAL review (PENDING_BOARD_REVIEW). The
 * counterparty must be identified either by an in-system participant id OR by a
 * free-text name; a relationship with neither is meaningless.
 */
export async function createSafetyLink(input: CreateInput) {
    const relationshipType = input.relationshipType as RelationshipType;
    if (!RELATIONSHIP_TYPES.has(relationshipType)) {
        throw new SafetyLinkError("bad_input", "Unknown relationship type.");
    }
    if (!input.description?.trim()) {
        throw new SafetyLinkError("bad_input", "A description of the relationship is required.");
    }
    if (!input.counterpartyParticipantId && !input.counterpartyName?.trim()) {
        throw new SafetyLinkError("bad_input", "Name the other person, or pick them from the directory.");
    }

    const subject = await prisma.participant.findUnique({ where: { id: input.subjectParticipantId }, select: { id: true } });
    if (!subject) throw new SafetyLinkError("not_found", "Subject participant not found.");

    const link = await prisma.safetyLink.create({
        data: {
            subjectParticipantId: input.subjectParticipantId,
            counterpartyParticipantId: input.counterpartyParticipantId ?? null,
            counterpartyName: input.counterpartyName?.trim() || null,
            counterpartyContact: input.counterpartyContact?.trim() || null,
            relationshipType,
            description: input.description.trim(),
            origin: input.origin ?? "SELF_DISCLOSED",
            disclosedById: input.disclosedById || SYSTEM_ACTOR,
            reviews: {
                create: {
                    subjectParticipantId: input.subjectParticipantId,
                    kind: "INITIAL",
                    status: "PENDING_BOARD_REVIEW",
                },
            },
        },
        include: { reviews: true },
    });

    await audit(input.disclosedById, link.id, {}, { created: true, status: "PENDING_BOARD_REVIEW" }, "CREATE");
    await notifyBoard();
    return link;
}

/**
 * Open a RENEWAL review against an existing link, reusing every fact already on
 * file (no re-entry). Allowed only when there is no review already in flight.
 * Callable by the subject or one of their household leads.
 */
export async function renewSafetyLink(linkId: number, actorId: number) {
    const link = await prisma.safetyLink.findUnique({
        where: { id: linkId },
        include: { reviews: { orderBy: { id: "desc" }, take: 1 } },
    });
    if (!link) throw new SafetyLinkError("not_found", "Safety link not found.");

    await assertSubjectOrHouseholdLead(link.subjectParticipantId, actorId);

    const latest = link.reviews[0];
    if (latest && (latest.status === "PENDING_BOARD_REVIEW" || latest.status === "PENDING_SUBJECT_ACTION")) {
        throw new SafetyLinkError("already_open", "A review for this link is already in progress.");
    }

    const review = await prisma.safetyLinkReview.create({
        data: {
            safetyLinkId: link.id,
            subjectParticipantId: link.subjectParticipantId,
            kind: "RENEWAL",
            status: "PENDING_BOARD_REVIEW",
        },
    });
    await audit(actorId, link.id, {}, { renewal: review.id, status: "PENDING_BOARD_REVIEW" }, "CREATE");
    await notifyBoard();
    return review;
}

/** Subject (or their household lead) withdraws a link — sets the latest review REVOKED. */
export async function withdrawSafetyLink(linkId: number, actorId: number) {
    const link = await prisma.safetyLink.findUnique({
        where: { id: linkId },
        include: { reviews: { orderBy: { id: "desc" }, take: 1 } },
    });
    if (!link) throw new SafetyLinkError("not_found", "Safety link not found.");
    await assertSubjectOrHouseholdLead(link.subjectParticipantId, actorId);

    const latest = link.reviews[0];
    if (!latest || latest.status === "REVOKED") throw new SafetyLinkError("wrong_phase", "Nothing to withdraw.");

    const updated = await prisma.safetyLinkReview.update({ where: { id: latest.id }, data: { status: "REVOKED" } });
    await audit(actorId, link.id, { status: latest.status }, { status: "REVOKED" });
    return updated;
}

export interface DecideInput {
    decision: "APPROVE" | "APPROVE_WITH_CONDITIONS" | "DENY" | "REQUEST_INFO";
    conditions?: string | null;
    note?: string | null;
}

/**
 * A board member decides a review (single entry, no quorum). Acts only on a
 * review awaiting board review.
 *   APPROVE / APPROVE_WITH_CONDITIONS -> stamp effectiveFrom + reviewBy (now + 1yr)
 *   DENY                              -> DENIED
 *   REQUEST_INFO                      -> PENDING_SUBJECT_ACTION (notify family)
 */
export async function decideReview(reviewId: number, boardMemberId: number, input: DecideInput) {
    const review = await prisma.safetyLinkReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new SafetyLinkError("not_found", "Review not found.");
    if (review.status !== "PENDING_BOARD_REVIEW") {
        throw new SafetyLinkError("wrong_phase", "This review is not awaiting board review.");
    }
    if (input.decision === "APPROVE_WITH_CONDITIONS" && !input.conditions?.trim()) {
        throw new SafetyLinkError("bad_input", "Conditions text is required to approve with conditions.");
    }

    const now = new Date();
    let status: string;
    const data: Record<string, unknown> = {
        decidedById: boardMemberId,
        decision: input.decision,
        decisionNote: input.note?.trim() || null,
    };

    switch (input.decision) {
        case "APPROVE":
            status = "APPROVED";
            data.effectiveFrom = now;
            data.reviewBy = daysFromNow(now, APPROVAL_VALID_DAYS);
            data.conditions = null;
            break;
        case "APPROVE_WITH_CONDITIONS":
            status = "APPROVED_WITH_CONDITIONS";
            data.effectiveFrom = now;
            data.reviewBy = daysFromNow(now, APPROVAL_VALID_DAYS);
            data.conditions = input.conditions!.trim();
            break;
        case "DENY":
            status = "DENIED";
            break;
        case "REQUEST_INFO":
            status = "PENDING_SUBJECT_ACTION";
            break;
        default:
            throw new SafetyLinkError("bad_input", "Unknown decision.");
    }
    data.status = status;

    const updated = await prisma.safetyLinkReview.update({ where: { id: reviewId }, data });
    await audit(boardMemberId, review.safetyLinkId, { status: review.status }, { status, decision: input.decision });

    if (input.decision === "REQUEST_INFO") {
        await notifySubjectFamily(review.subjectParticipantId, "The board needs more information about a safety link you disclosed", input.note?.trim());
    }
    return updated;
}

/** Board / sysadmin override: force a review to a terminal state regardless of phase. */
export async function overrideReview(reviewId: number, actorId: number, action: "approve" | "deny" | "revoke") {
    const review = await prisma.safetyLinkReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new SafetyLinkError("not_found", "Review not found.");

    const now = new Date();
    const data: Record<string, unknown> = { decidedById: actorId };
    if (action === "approve") {
        data.status = "APPROVED";
        data.decision = "APPROVE";
        data.effectiveFrom = now;
        data.reviewBy = daysFromNow(now, APPROVAL_VALID_DAYS);
    } else if (action === "deny") {
        data.status = "DENIED";
        data.decision = "DENY";
    } else {
        data.status = "REVOKED";
    }

    const updated = await prisma.safetyLinkReview.update({ where: { id: reviewId }, data });
    await audit(actorId, review.safetyLinkId, { status: review.status }, { status: data.status, override: action });
    return updated;
}

/**
 * Nightly sweep: (1) warn the family 30 days before an approval lapses, once;
 * (2) expire approvals whose reviewBy has passed so they re-enter the board queue
 * via a renewal.
 */
export async function runExpirySweep(now: Date) {
    const warnThreshold = daysFromNow(now, WARN_LEAD_DAYS);

    const expiring = await prisma.safetyLinkReview.findMany({
        where: {
            status: { in: ["APPROVED", "APPROVED_WITH_CONDITIONS"] },
            warnedAt: null,
            reviewBy: { not: null, lte: warnThreshold, gt: now },
        },
        select: { id: true, safetyLinkId: true, subjectParticipantId: true, reviewBy: true },
    });
    let warned = 0;
    for (const r of expiring) {
        const due = r.reviewBy ? r.reviewBy.toISOString().slice(0, 10) : "soon";
        await notifySubjectFamily(
            r.subjectParticipantId,
            "A safety link is expiring soon",
            `This board-approved relationship expires on ${due}. You can resubmit it for board review in one click — no need to re-enter anything.`,
        );
        await prisma.safetyLinkReview.update({ where: { id: r.id }, data: { warnedAt: now } });
        warned++;
    }

    const lapsed = await prisma.safetyLinkReview.findMany({
        where: {
            status: { in: ["APPROVED", "APPROVED_WITH_CONDITIONS"] },
            reviewBy: { not: null, lte: now },
        },
        select: { id: true, safetyLinkId: true, status: true },
    });
    let expired = 0;
    for (const r of lapsed) {
        await prisma.safetyLinkReview.update({ where: { id: r.id }, data: { status: "EXPIRED" } });
        await audit(SYSTEM_ACTOR, r.safetyLinkId, { status: r.status }, { status: "EXPIRED" });
        expired++;
    }

    return { warned, expired };
}

/** True if actor is the subject or a lead of the subject's household. */
async function assertSubjectOrHouseholdLead(subjectId: number, actorId: number) {
    if (actorId === subjectId) return;
    const subject = await prisma.participant.findUnique({ where: { id: subjectId }, select: { householdId: true } });
    if (subject) {
        const lead = await prisma.householdLead.findFirst({
            where: { householdId: subject.householdId, participantId: actorId },
            select: { participantId: true },
        });
        if (lead) return;
    }
    throw new SafetyLinkError("forbidden", "You may only act on safety links for yourself or your household.");
}

/** Email every board member that a safety-link review is waiting. */
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
                          "Safety link: a disclosure needs board review",
                          `<p>A dual-relationship disclosure is awaiting board review. <a href="${base}/admin/safety-links">Review it</a>.</p>`,
                      ).catch((e) => logger.error("Board safety-link ping failed:", e))
                    : Promise.resolve(),
            ),
        );
    } catch (e) {
        logger.error("notifyBoard failed:", e);
    }
}

/** Email the subject's household leads (the "family"). */
async function notifySubjectFamily(subjectId: number, subject: string, body?: string): Promise<void> {
    try {
        const participant = await prisma.participant.findUnique({ where: { id: subjectId }, select: { householdId: true } });
        if (!participant) return;
        const leads = await prisma.householdLead.findMany({
            where: { householdId: participant.householdId },
            select: { participant: { select: { email: true } } },
        });
        const base = process.env.NEXTAUTH_URL ?? "";
        const html = `<p>${body ?? ""}</p><p><a href="${base}/safety-links">View your safety links</a>.</p>`;
        await Promise.all(
            leads
                .map((l) => l.participant?.email)
                .filter((e): e is string => !!e)
                .map((email) => sendEmail(email, subject, html).catch((e) => logger.error("Family safety-link ping failed:", e))),
        );
    } catch (e) {
        logger.error("notifySubjectFamily failed:", e);
    }
}

function audit(
    actorId: number,
    linkId: number,
    oldData: object,
    newData: object,
    action: "CREATE" | "EDIT" = "EDIT",
) {
    return prisma.auditLog.create({
        data: {
            actorId: actorId || SYSTEM_ACTOR,
            action,
            tableName: "SafetyLink",
            affectedEntityId: linkId,
            oldData: JSON.stringify(oldData),
            newData: JSON.stringify(newData),
        },
    });
}
