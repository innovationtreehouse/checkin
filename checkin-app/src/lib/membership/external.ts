import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { backgroundCheckProvider } from "@/lib/membership/background-check/manual-adapter";
import { notifyReviewers } from "@/lib/membership/review";
import {
    createRequest,
    submitRequest,
    getAccessToken,
    getEmbeddedSignUrl,
} from "@/lib/membership/contract/zohoClient";
import { loadAgreementPdf, stampWatermark, AGREEMENT_FILENAME, AgreementUnavailableError } from "@/lib/membership/contract/agreementDocument";

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

export type ExternalErrorCode =
    | "not_found"
    | "wrong_phase"
    | "not_lead"
    | "no_household"
    | "not_configured"
    | "agreement_unavailable";

export class ExternalError extends Error {
    constructor(public readonly code: ExternalErrorCode, message: string) {
        super(message);
        this.name = "ExternalError";
    }
}

export interface ExternalStatus {
    contractSigned: boolean;
    /** True once a Zoho signing request exists — lets the UI say "Resume signing". */
    contractStarted: boolean;
    bgConsented: boolean;
    deepLinkUrl: string | null;
}

/** Applicant-facing status of the two external actions (+ the consent deep link). */
export async function getExternalStatus(process: {
    contractSignedAt: Date | null;
    bgConsentAt: Date | null;
    zohoEnvelopeId: string | null;
}): Promise<ExternalStatus> {
    return {
        contractSigned: !!process.contractSignedAt,
        contractStarted: !!process.zohoEnvelopeId,
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

/** Days an applicant has to sign before the Zoho request expires (mirrors the script's default). */
const CONTRACT_EXPIRATION_DAYS = 15;

/**
 * Applicant-facing "Sign your membership agreement" action. Idempotent: the Zoho
 * signing request/document is created at most once (its request + action ids are
 * stored on the process), then every call mints a fresh short-lived EMBEDDED sign
 * URL so the applicant goes straight into the signing ceremony in-app.
 *
 * Returns the embedded sign URL. Throws ExternalError for the caller to map to HTTP.
 */
export async function getOrCreateContractSigningUrl(userId: number): Promise<string> {
    if (!config.zohoConfigured()) {
        throw new ExternalError("not_configured", "Agreement signing isn't available yet. Please check back soon.");
    }

    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: {
            householdLeads: true,
            household: { include: { membership: { include: { processes: true } } } },
        },
    });
    if (!user) throw new ExternalError("not_found", "Application not found.");
    if (!user.householdId) throw new ExternalError("no_household", "You must create a household first.");
    const isLead = user.householdLeads.some((l) => l.householdId === user.householdId);
    if (!isLead && !user.sysadmin) {
        throw new ExternalError("not_lead", "Only a household lead can sign the membership agreement.");
    }

    const process = (user.household?.membership?.processes ?? [])
        .filter((p) => p.kind === "INITIAL" && p.status === "PENDING_EXTERNAL_ACTION")
        .sort((a, b) => b.id - a.id)[0];
    if (!process) throw new ExternalError("wrong_phase", "No application is awaiting your signature.");

    const recipientEmail = user.email;
    const recipientName = user.name?.trim() || user.email || "Applicant";
    if (!recipientEmail) throw new ExternalError("not_found", "Your account has no email on file to sign with.");

    const token = await getAccessToken();

    // Create the request once; reuse the stored ids on every later click so the
    // document is never re-generated (only the embed session below is ephemeral).
    let requestId = process.zohoEnvelopeId;
    let actionId = process.zohoActionId;
    if (!requestId || !actionId) {
        let agreement;
        try {
            agreement = await loadAgreementPdf();
        } catch (e) {
            if (e instanceof AgreementUnavailableError) {
                throw new ExternalError("agreement_unavailable", "The membership agreement isn't ready yet. Please check back soon.");
            }
            throw e;
        }

        // On non-prod instances, mark the request + document as a DEV test so a
        // signature can never be mistaken for a binding one — baked in server-side
        // (CHECKIN_ENV), not editable by the applicant. Prod stays clean. The
        // create/submit/embed flow is otherwise identical across envs.
        const isProd = config.isProd();
        const pdf = isProd ? agreement.pdf : await stampWatermark(agreement.pdf, "DEV TEST — NOT A LEGAL AGREEMENT");
        const requestName = `${isProd ? "" : "[DEV TEST — NOT BINDING] "}Membership Agreement — ${recipientName}`;

        const created = await createRequest({
            token,
            pdf,
            filename: AGREEMENT_FILENAME,
            recipientEmail,
            recipientName,
            requestName,
            expirationDays: CONTRACT_EXPIRATION_DAYS,
        });
        await submitRequest({
            token,
            requestId: created.requestId,
            actionId: created.actionId,
            documentId: created.documentId,
            recipientEmail,
            recipientName,
            lastPageNo: agreement.lastPageNo,
            pageWidth: agreement.pageWidth,
            pageHeight: agreement.pageHeight,
            prefill: { PrintedName: recipientName },
        });

        requestId = created.requestId;
        actionId = created.actionId;
        await prisma.membershipProcess.update({
            where: { id: process.id },
            data: { zohoEnvelopeId: requestId, zohoActionId: actionId },
        });
        await prisma.auditLog.create({
            data: {
                actorId: userId,
                action: "EDIT",
                tableName: "MembershipProcess",
                affectedEntityId: process.id,
                newData: JSON.stringify({ zohoEnvelopeId: requestId, zohoActionId: actionId }),
            },
        });
        logger.info(`Created Zoho signing request ${requestId} for membership process ${process.id}.`);
    }

    return getEmbeddedSignUrl({ token, requestId, actionId, host: config.baseUrl() });
}
