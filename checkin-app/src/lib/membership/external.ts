import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { logger } from "@/lib/logger";
import { backgroundCheckProvider } from "@/lib/membership/background-check/manual-adapter";
import { notifyReviewers } from "@/lib/membership/review";
import { zohoSign } from "@/lib/membership/contract/zohoProvider";
import { loadAgreementPdf, stampWatermark, AGREEMENT_FILENAME, AgreementUnavailableError } from "@/lib/membership/contract/agreementDocument";
import { latestPendingExternal } from "@/lib/membership/phases";

/**
 * EXTERNAL-phase service — the actions an applicant completes after intake:
 * signing the Zoho contract and consenting to a background check on Averity.
 * Once the contract is signed AND the check is handled (consent recorded, or a
 * still-valid prior check detected), the application advances to PENDING_PAYMENT.
 * The background check is NOT a gate on payment — it reviews in parallel and only
 * the final ACTIVE transition waits on it.
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
    /** True when a still-valid prior check was detected — no new check is needed. */
    bgCleared: boolean;
    deepLinkUrl: string | null;
}

/** Applicant-facing status of the two external actions (+ the consent deep link). */
export async function getExternalStatus(process: {
    contractSignedAt: Date | null;
    bgConsentAt: Date | null;
    bgClearedAt: Date | null;
    zohoEnvelopeId: string | null;
}): Promise<ExternalStatus> {
    return {
        contractSigned: !!process.contractSignedAt,
        contractStarted: !!process.zohoEnvelopeId,
        bgConsented: !!process.bgConsentAt,
        bgCleared: !!process.bgClearedAt,
        deepLinkUrl: await backgroundCheckProvider.getConsentDeepLink(),
    };
}

/**
 * Once the contract is signed AND the background check is handled — either a
 * still-valid prior check (bgClearedAt) or fresh consent recorded (bgConsentAt)
 * — advance from EXTERNAL straight to PENDING_PAYMENT. The check no longer gates
 * payment: when it still needs a human review (no prior valid check), it runs in
 * PARALLEL while the applicant pays, and only the final ACTIVE flip waits on it.
 *
 * The conditional updateMany (status guard) is the atomic gate: two concurrent
 * callers (Zoho webhook + board "mark bg consent") both reach here, but only the
 * one whose updateMany flips PENDING_EXTERNAL_ACTION sees count === 1 — so the
 * audit row and reviewer ping fire exactly once, and a later status is never
 * regressed. Mirrors review.ts `attest`.
 */
export async function advanceExternalIfComplete(processId: number) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) return process;
    if (process.status !== "PENDING_EXTERNAL_ACTION") return process;
    if (!process.contractSignedAt) return process;
    if (!process.bgClearedAt && !process.bgConsentAt) return process;

    const advanced = await prisma.$transaction(async (tx) => {
        const { count } = await tx.membershipProcess.updateMany({
            where: {
                id: processId,
                status: "PENDING_EXTERNAL_ACTION",
                contractSignedAt: { not: null },
                OR: [{ bgClearedAt: { not: null } }, { bgConsentAt: { not: null } }],
            },
            data: { status: "PENDING_PAYMENT", stageEnteredAt: new Date() },
        });
        if (count !== 1) return null; // lost the race or no longer eligible — no audit, no notify
        await tx.auditLog.create({
            data: {
                actorId: SYSTEM_ACTOR,
                action: "EDIT",
                tableName: "MembershipProcess",
                affectedEntityId: processId,
                oldData: { status: "PENDING_EXTERNAL_ACTION" },
                newData: { status: "PENDING_PAYMENT" },
            },
        });
        return tx.membershipProcess.findUnique({ where: { id: processId } });
    });
    if (!advanced) return prisma.membershipProcess.findUnique({ where: { id: processId } });

    // No valid prior check ⇒ a human review is still needed. Ping the reviewers;
    // the review now proceeds in parallel with payment (log-only until email is configured).
    if (!advanced.bgClearedAt) await notifyReviewers();
    return advanced;
}

/** Record that the membership contract was signed (idempotent), then maybe advance. */
export async function markContractSigned(processId: number, actorId: number = SYSTEM_ACTOR) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ExternalError("not_found", "Application not found.");
    // Conditional on contractSignedAt: null — two concurrent Zoho webhook retries
    // both see null, but only the winner's updateMany flips it (count === 1), so the
    // audit row is written once.
    await prisma.$transaction(async (tx) => {
        const { count } = await tx.membershipProcess.updateMany({
            where: { id: processId, contractSignedAt: null },
            data: { contractSignedAt: new Date() },
        });
        if (count !== 1) return;
        await tx.auditLog.create({
            data: { actorId, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, newData: { contractSignedAt: true } },
        });
    });
    return advanceExternalIfComplete(processId);
}

/** Board human-marks that the applicant submitted background-check consent, then maybe advance. */
export async function markBgConsent(processId: number, actorId: number) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ExternalError("not_found", "Application not found.");
    // Conditional on bgConsentAt: null so concurrent marks write the audit row once.
    await prisma.$transaction(async (tx) => {
        const { count } = await tx.membershipProcess.updateMany({
            where: { id: processId, bgConsentAt: null },
            data: { bgConsentAt: new Date() },
        });
        if (count !== 1) return;
        await tx.auditLog.create({
            data: { actorId, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, newData: { bgConsentAt: true } },
        });
    });
    return advanceExternalIfComplete(processId);
}

/** Associate a Zoho signing request id with a process so its webhook can match. */
export async function setZohoEnvelope(processId: number, requestId: string, actorId: number) {
    const process = await prisma.membershipProcess.findUnique({ where: { id: processId } });
    if (!process) throw new ExternalError("not_found", "Application not found.");
    const updated = await prisma.membershipProcess.update({ where: { id: processId }, data: { zohoEnvelopeId: requestId } });
    await prisma.auditLog.create({
        data: { actorId, action: "EDIT", tableName: "MembershipProcess", affectedEntityId: processId, newData: { zohoEnvelopeId: requestId } },
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
    const process = latestPendingExternal(user?.household?.membership?.processes);
    if (!process) return null;

    if (!process.contractSignedAt && process.zohoEnvelopeId && config.zohoAvailable()) {
        try {
            const token = await zohoSign.getAccessToken();
            if (await zohoSign.getRequestStatus(token, process.zohoEnvelopeId)) {
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
    if (!config.zohoAvailable()) {
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
    if (!isLead && !user.isSysadmin) {
        throw new ExternalError("not_lead", "Only a household lead can sign the membership agreement.");
    }

    // Any kind in the EXTERNAL phase — INITIAL applications AND renewals, which
    // re-sign the agreement fresh each cycle. Gating on status alone keeps this in
    // step with getIntakeState/getExternalStatus, which surface the button for any
    // non-ACTIVE process (a kind filter here would render the button then 409).
    const process = latestPendingExternal(user.household?.membership?.processes);
    if (!process) throw new ExternalError("wrong_phase", "No application is awaiting your signature.");

    const recipientEmail = user.email;
    const recipientName = user.name?.trim() || user.email || "Applicant";
    if (!recipientEmail) throw new ExternalError("not_found", "Your account has no email on file to sign with.");

    const token = await zohoSign.getAccessToken();

    // Create the request once; reuse the stored ids on every later click so the
    // document is never re-generated (only the embed session below is ephemeral).
    let requestId = process.zohoEnvelopeId;
    let actionId = process.zohoActionId;
    if (!requestId || !actionId) {
        // Mock mode never uploads the PDF (its createRequest ignores the bytes), so
        // skip the S3 load that also 503s in dev — an empty placeholder keeps the
        // create/submit calls type-identical. See ZOHO_SIGN_DEV_MOCK.md §5.
        let agreement;
        if (config.zohoMockActive()) {
            agreement = { pdf: Buffer.alloc(0), lastPageNo: 0, pageWidth: 0, pageHeight: 0 };
        } else {
            try {
                agreement = await loadAgreementPdf();
            } catch (e) {
                if (e instanceof AgreementUnavailableError) {
                    throw new ExternalError("agreement_unavailable", "The membership agreement isn't ready yet. Please check back soon.");
                }
                throw e;
            }
        }

        // On non-prod instances, mark the request + document as a DEV test so a
        // signature can never be mistaken for a binding one — baked in server-side
        // (CHECKIN_ENV), not editable by the applicant. Prod stays clean. The
        // create/submit/embed flow is otherwise identical across envs. (Mock mode
        // skips the watermark — the empty placeholder PDF is never rendered.)
        const isProd = config.isProd();
        const pdf = isProd || config.zohoMockActive() ? agreement.pdf : await stampWatermark(agreement.pdf, "DEV TEST — NOT A LEGAL AGREEMENT");
        const requestName = `${isProd ? "" : "[DEV TEST — NOT BINDING] "}Membership Agreement — ${recipientName}`;

        // Return the embedded signer to checkin when they finish (Zoho navigates
        // the window to these). signed=1 lets the membership page confirm + refresh.
        const membershipUrl = `${config.baseUrl()}/membership`;
        const created = await zohoSign.createRequest({
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
        await zohoSign.submitRequest({
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
                    newData: { zohoEnvelopeId: requestId, zohoActionId: actionId },
                },
            });
            logger.info(`Created Zoho signing request ${requestId} for membership process ${process.id}.`);
        }
    }

    return zohoSign.getEmbeddedSignUrl({ token, requestId, actionId, host: config.baseUrl() });
}
