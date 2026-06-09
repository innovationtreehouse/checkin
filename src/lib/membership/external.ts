import prisma from "@/lib/prisma";
import { backgroundCheckProvider } from "@/lib/membership/background-check/manual-adapter";
import { notifyReviewers } from "@/lib/membership/review";

/**
 * EXTERNAL-phase service — the two parallel actions an applicant completes after
 * intake: signing the Zoho contract and consenting to a background check on
 * Averity. When BOTH are recorded, the application advances to PENDING_BG_REVIEW.
 *
 * The contract is recorded automatically (Zoho webhook) or manually by the
 * board; BG consent is always human-marked by the board (no Averity API). The
 * system never sees contract content or check results.
 *
 * actorId 0 denotes a system actor (e.g. the Zoho webhook) in the audit log.
 */
const SYSTEM_ACTOR = 0;

export class ExternalError extends Error {
    constructor(public readonly code: "not_found" | "wrong_phase", message: string) {
        super(message);
        this.name = "ExternalError";
    }
}

export interface ExternalStatus {
    contractSigned: boolean;
    bgConsented: boolean;
    deepLinkUrl: string | null;
}

/** Applicant-facing status of the two external actions (+ the consent deep link). */
export async function getExternalStatus(process: { contractSignedAt: Date | null; bgConsentAt: Date | null }): Promise<ExternalStatus> {
    return {
        contractSigned: !!process.contractSignedAt,
        bgConsented: !!process.bgConsentAt,
        deepLinkUrl: await backgroundCheckProvider.getConsentDeepLink(),
    };
}

/** If both external actions are done and we're still in EXTERNAL, advance to PENDING_BG_REVIEW. */
export async function advanceExternalIfComplete(processId: number) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process || process.status !== "PENDING_EXTERNAL_ACTION") return process;
    if (!process.contractSignedAt || !process.bgConsentAt) return process;

    const advanced = await prisma.membershipProcess.update({
        where: { id: processId },
        data: { status: "PENDING_BG_REVIEW", stageEnteredAt: new Date() },
    });
    await prisma.auditLog.create({
        data: {
            actorId: SYSTEM_ACTOR,
            action: "EDIT",
            tableName: "MembershipProcess",
            affectedEntityId: processId,
            oldData: JSON.stringify({ status: "PENDING_EXTERNAL_ACTION" }),
            newData: JSON.stringify({ status: "PENDING_BG_REVIEW" }),
        },
    });
    // Ping background-check reviewers that an application is ready (log-only until email is configured).
    await notifyReviewers();
    return advanced;
}

/** Record that the membership contract was signed (idempotent), then maybe advance. */
export async function markContractSigned(processId: number, actorId: number = SYSTEM_ACTOR) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ExternalError("not_found", "Application not found.");
    if (!process.contractSignedAt) {
        await prisma.membershipProcess.update({ where: { id: processId }, data: { contractSignedAt: new Date() } });
        await prisma.auditLog.create({
            data: { actorId, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, newData: JSON.stringify({ contractSignedAt: true }) },
        });
    }
    return advanceExternalIfComplete(processId);
}

/** Board human-marks that the applicant submitted background-check consent, then maybe advance. */
export async function markBgConsent(processId: number, actorId: number) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ExternalError("not_found", "Application not found.");
    if (!process.bgConsentAt) {
        await prisma.membershipProcess.update({ where: { id: processId }, data: { bgConsentAt: new Date() } });
        await prisma.auditLog.create({
            data: { actorId, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, newData: JSON.stringify({ bgConsentAt: true }) },
        });
    }
    return advanceExternalIfComplete(processId);
}

/** Associate a Zoho signing request id with a process so its webhook can match. */
export async function setZohoEnvelope(processId: number, requestId: string, actorId: number) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ExternalError("not_found", "Application not found.");
    const updated = await prisma.membershipProcess.update({ where: { id: processId }, data: { zohoEnvelopeId: requestId } });
    await prisma.auditLog.create({
        data: { actorId, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, newData: JSON.stringify({ zohoEnvelopeId: requestId }) },
    });
    return updated;
}

/** Find the in-flight process tied to a Zoho request id (for webhook matching). */
export async function findProcessByEnvelope(requestId: string) {
    return prisma.membershipProcess.findFirst({ where: { zohoEnvelopeId: requestId } });
}
