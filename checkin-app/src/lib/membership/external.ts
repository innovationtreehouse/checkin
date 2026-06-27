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
    getRequestStatus,
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

/**
 * Pull the contract status from Zoho for the applicant's in-flight process and
 * record it signed if Zoho says so. Called when the signer returns from embedded
 * signing (?signed=1) so completion doesn't hinge on the inbound webhook — which
 * is unreliable against a scale-to-zero dev instance that may be asleep when Zoho
 * fires it. Best-effort: a Zoho hiccup is swallowed (the webhook is the backstop)
 * and the current status is returned regardless. Returns null when the user has no
 * in-flight signing process.
 */
export async function syncContractStatus(userId: number): Promise<ExternalStatus | null> {
    const user = await prisma.participant.findUnique({
        where: { id: userId },
        include: { household: { include: { membership: { include: { processes: true } } } } },
    });
    // Same selection as the signing action: the latest process awaiting external action.
    const process = (user?.household?.membership?.processes ?? [])
        .filter((p) => p.status === "PENDING_EXTERNAL_ACTION")
        .sort((a, b) => b.id - a.id)[0];
    if (!process) return null;

    if (!process.contractSignedAt && process.zohoEnvelopeId && config.zohoConfigured()) {
        try {
            const token = await getAccessToken();
            if (await getRequestStatus(token, process.zohoEnvelopeId)) {
                await markContractSigned(process.id, userId);
            }
        } catch (e) {
            logger.error(`Zoho status sync failed for process ${process.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
    }

    // Re-read: markContractSigned may have flipped contractSignedAt (and advanced the phase).
    const fresh = await prisma.membershipProcess.findUnique({ where: { id: process.id } });
    return fresh ? getExternalStatus(fresh) : null;
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

    // Any kind in the EXTERNAL phase — INITIAL applications AND renewals, which
    // re-sign the agreement fresh each cycle. Gating on status alone keeps this in
    // step with getIntakeState/getExternalStatus, which surface the button for any
    // non-ACTIVE process (a kind filter here would render the button then 409).
    const process = (user.household?.membership?.processes ?? [])
        .filter((p) => p.status === "PENDING_EXTERNAL_ACTION")
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

        // Return the embedded signer to checkin when they finish (Zoho navigates
        // the window to these). signed=1 lets the membership page confirm + refresh.
        const membershipUrl = `${config.baseUrl()}/membership`;
        const created = await createRequest({
            token,
            pdf,
            filename: AGREEMENT_FILENAME,
            recipientEmail,
            recipientName,
            requestName,
            expirationDays: CONTRACT_EXPIRATION_DAYS,
            redirectPages: {
                sign_completed: `${membershipUrl}?signed=1`,
                sign_success: `${membershipUrl}?signed=1`,
                sign_declined: `${membershipUrl}?declined=1`,
                sign_later: membershipUrl,
            },
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

        // Atomically claim the process for THIS request's ids. Two concurrent
        // POSTs can both pass the null check above and both create a Zoho request;
        // this conditional update lets only the first writer win. If we lost the
        // race (count 0), discard our just-created request and reuse the winner's
        // stored ids so the process keeps a single canonical signing request — our
        // orphaned Zoho request simply expires.
        //
        // The claim matches an INCOMPLETE pair (either id null), not just a null
        // envelope: setZohoEnvelope (the legacy admin/email flow) stores
        // zohoEnvelopeId WITHOUT an action id, which can't be embedded. That state
        // must be claimable here or the create-trigger above (needs both ids) would
        // re-create on every click and a `zohoEnvelopeId: null`-only claim would
        // always lose — a permanent 409. Overwriting it points the process (and its
        // webhook match) at the embeddable in-app request.
        const claim = await prisma.membershipProcess.updateMany({
            where: { id: process.id, OR: [{ zohoEnvelopeId: null }, { zohoActionId: null }] },
            data: { zohoEnvelopeId: created.requestId, zohoActionId: created.actionId },
        });
        if (claim.count === 0) {
            const winner = await prisma.membershipProcess.findUnique({ where: { id: process.id } });
            requestId = winner?.zohoEnvelopeId ?? null;
            actionId = winner?.zohoActionId ?? null;
            if (!requestId || !actionId) {
                throw new ExternalError("wrong_phase", "Your signing request is still being prepared. Please try again in a moment.");
            }
            logger.info(`Concurrent signing request for membership process ${process.id}; reusing stored ${requestId}.`);
        } else {
            requestId = created.requestId;
            actionId = created.actionId;
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
    }

    return getEmbeddedSignUrl({ token, requestId, actionId, host: config.baseUrl() });
}
