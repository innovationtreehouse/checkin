/**
 * @jest-environment node
 */
/**
 * Unit tests for external.ts (prisma + config + zoho provider mocked, no DB):
 *   - setZohoEnvelope / findProcessByEnvelope: simple prisma passthroughs.
 *   - getOrCreateContractSigningUrl: the guard chain (not_configured/not_found/
 *     no_household/not_lead/wrong_phase), the mock-mode PDF short-circuit, and
 *     the already-claimed-ids short-circuit.
 *   - advanceExternalIfComplete: the volunteer-designation allowlist is matched
 *     at the PENDING_PAYMENT transition (#874) — and only by the race winner.
 */
import { setZohoEnvelope, findProcessByEnvelope, getOrCreateContractSigningUrl, selfAttestBgConsent, advanceExternalIfComplete, ExternalError } from '@/lib/membership/external';

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: { findUnique: jest.fn() },
        orgMembership: { findUnique: jest.fn() },
        orgMembershipProcess: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
        // signingMockActive reads the dev signing-target radio; null = default ('zoho').
        boardSettings: { findUnique: jest.fn().mockResolvedValue(null) },
        $transaction: jest.fn(),
    },
}));

jest.mock('@/lib/membership/review', () => ({
    notifyReviewers: jest.fn().mockResolvedValue(undefined),
    applyVolunteerStatus: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/config', () => {
    const actual = jest.requireActual('@/lib/config');
    return {
        ...actual,
        config: {
            ...actual.config,
            zohoAvailable: jest.fn(),
            zohoMockActive: jest.fn(),
            isProd: jest.fn(),
            baseUrl: jest.fn(() => 'https://checkin.example.org'),
        },
    };
});

jest.mock('@/lib/membership/contract/zohoProvider', () => ({
    zohoSign: {
        getAccessToken: jest.fn(),
        createRequest: jest.fn(),
        submitRequest: jest.fn(),
        getEmbeddedSignUrl: jest.fn(),
        getRequestStatus: jest.fn(),
    },
}));

jest.mock('@/lib/membership/contract/agreementDocument', () => {
    const actual = jest.requireActual('@/lib/membership/contract/agreementDocument');
    return { ...actual, loadAgreementPdf: jest.fn(), stampWatermark: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { config } = require('@/lib/config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { zohoSign } = require('@/lib/membership/contract/zohoProvider');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { loadAgreementPdf, stampWatermark, AgreementUnavailableError } = require('@/lib/membership/contract/agreementDocument');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { notifyReviewers, applyVolunteerStatus } = require('@/lib/membership/review');

beforeEach(() => {
    jest.clearAllMocks();
    config.zohoAvailable.mockReturnValue(true);
    config.zohoMockActive.mockReturnValue(true);
    config.isProd.mockReturnValue(false);
    config.baseUrl.mockReturnValue('https://checkin.example.org');
});

describe('setZohoEnvelope', () => {
    it('not_found when the process does not exist', async () => {
        prisma.orgMembershipProcess.findUnique.mockResolvedValue(null);
        await expect(setZohoEnvelope(1, 'req-1', 5)).rejects.toBeInstanceOf(ExternalError);
    });

    it('updates the envelope id and writes an audit row', async () => {
        prisma.orgMembershipProcess.findUnique.mockResolvedValue({ id: 1 });
        prisma.orgMembershipProcess.update.mockResolvedValue({ id: 1, zohoEnvelopeId: 'req-1' });

        const result = await setZohoEnvelope(1, 'req-1', 5);

        expect(prisma.orgMembershipProcess.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { zohoEnvelopeId: 'req-1' } });
        expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ id: 1, zohoEnvelopeId: 'req-1' });
    });
});

describe('findProcessByEnvelope', () => {
    it('looks up the process by zohoEnvelopeId', async () => {
        prisma.orgMembershipProcess.findFirst.mockResolvedValue({ id: 9 });
        const result = await findProcessByEnvelope('req-9');
        expect(prisma.orgMembershipProcess.findFirst).toHaveBeenCalledWith({ where: { zohoEnvelopeId: 'req-9' } });
        expect(result).toEqual({ id: 9 });
    });
});

describe('selfAttestBgConsent', () => {
    const pendingProcess = {
        id: 20,
        status: 'PENDING_EXTERNAL_ACTION',
        contractSignedAt: null,
        bgConsentAt: null,
        bgClearedAt: null,
        zohoEnvelopeId: null,
    };
    const leadUser = {
        id: 1,
        householdId: 7,
        isSysadmin: false,
        isHouseholdLead: true,
        household: { orgMembership: { processes: [pendingProcess] } },
    };

    it('not_found when the user does not exist', async () => {
        prisma.person.findUnique.mockResolvedValue(null);
        await expect(selfAttestBgConsent(1)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('no_household when the user has no household', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...leadUser, householdId: null });
        await expect(selfAttestBgConsent(1)).rejects.toMatchObject({ code: 'no_household' });
    });

    it('not_lead when the caller is not a household lead and not a sysadmin', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...leadUser, isHouseholdLead: false });
        await expect(selfAttestBgConsent(1)).rejects.toMatchObject({ code: 'not_lead' });
    });

    it('wrong_phase when no process is awaiting external action', async () => {
        prisma.person.findUnique.mockResolvedValue({
            ...leadUser,
            household: { orgMembership: { processes: [{ ...pendingProcess, status: 'PENDING_PAYMENT' }] } },
        });
        await expect(selfAttestBgConsent(1)).rejects.toMatchObject({ code: 'wrong_phase' });
    });

    it('records consent with the applicant as the audit actor and returns the external status', async () => {
        prisma.person.findUnique.mockResolvedValue(leadUser);
        prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });
        prisma.orgMembershipProcess.findUnique
            .mockResolvedValueOnce(pendingProcess) // markBgConsent guard
            // advanceExternalIfComplete re-read: consent set, contract still unsigned → no advance
            .mockResolvedValueOnce({ ...pendingProcess, bgConsentAt: new Date() });

        const status = await selfAttestBgConsent(1);

        expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 20, bgConsentAt: null } }),
        );
        expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: 1 }) });
        expect(status.bgConsented).toBe(true);
        expect(status.contractSigned).toBe(false);
    });
});

describe('advanceExternalIfComplete', () => {
    const readyProcess = {
        id: 20,
        orgMembershipId: 42,
        status: 'PENDING_EXTERNAL_ACTION',
        contractSignedAt: new Date(),
        bgConsentAt: new Date(),
        bgClearedAt: null,
    };

    beforeEach(() => {
        prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
        prisma.orgMembership.findUnique.mockResolvedValue({ householdId: 7, household: { intakeNotes: null } });
    });

    it('winner: applies the volunteer allowlist at the PENDING_PAYMENT transition (#874) and pings reviewers', async () => {
        const advanced = { ...readyProcess, status: 'PENDING_PAYMENT' };
        prisma.orgMembershipProcess.findUnique
            .mockResolvedValueOnce(readyProcess) // pre-tx eligibility read
            .mockResolvedValueOnce(advanced); // re-read inside the tx
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });

        const result = await advanceExternalIfComplete(20);

        // Allowlist matched now — dues are read at PENDING_PAYMENT, before clearance.
        expect(applyVolunteerStatus).toHaveBeenCalledWith(prisma, 42, 7, false);
        expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
        expect(notifyReviewers).toHaveBeenCalledTimes(1); // check not yet cleared → review still needed
        expect(result).toEqual(advanced);
    });

    it('winner with a prior valid check (bgClearedAt) still applies the allowlist but does not ping reviewers', async () => {
        const cleared = { ...readyProcess, bgConsentAt: null, bgClearedAt: new Date() };
        prisma.orgMembershipProcess.findUnique
            .mockResolvedValueOnce(cleared)
            .mockResolvedValueOnce({ ...cleared, status: 'PENDING_PAYMENT' });
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });

        await advanceExternalIfComplete(20);

        expect(applyVolunteerStatus).toHaveBeenCalledWith(prisma, 42, 7, false);
        expect(notifyReviewers).not.toHaveBeenCalled();
    });

    it('household intake note → holds at PENDING_BG_REVIEW instead of PENDING_PAYMENT (#907)', async () => {
        prisma.orgMembership.findUnique.mockResolvedValue({ householdId: 7, household: { intakeNotes: 'treat us as a volunteer household' } });
        const held = { ...readyProcess, status: 'PENDING_BG_REVIEW' };
        prisma.orgMembershipProcess.findUnique
            .mockResolvedValueOnce(readyProcess)
            .mockResolvedValueOnce(held);
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });

        const result = await advanceExternalIfComplete(20);

        expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_BG_REVIEW' }) }),
        );
        // Allowlist still applied (sticky/idempotent); reviewers pinged to read the note.
        expect(applyVolunteerStatus).toHaveBeenCalledWith(prisma, 42, 7, false);
        expect(notifyReviewers).toHaveBeenCalledTimes(1);
        expect(result).toEqual(held);
    });

    it('note + already-cleared check (legacy in-flight row) keeps the direct PENDING_PAYMENT path', async () => {
        // PENDING_BG_REVIEW would be invisible to the review queue once bgClearedAt is
        // set, so such rows must not be held — they advance as before.
        prisma.orgMembership.findUnique.mockResolvedValue({ householdId: 7, household: { intakeNotes: 'a note' } });
        const cleared = { ...readyProcess, bgConsentAt: null, bgClearedAt: new Date() };
        prisma.orgMembershipProcess.findUnique
            .mockResolvedValueOnce(cleared)
            .mockResolvedValueOnce({ ...cleared, status: 'PENDING_PAYMENT' });
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });

        await advanceExternalIfComplete(20);

        expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_PAYMENT' }) }),
        );
        expect(notifyReviewers).not.toHaveBeenCalled();
    });

    it('loser of the race (count 0): no allowlist match, no audit, no ping', async () => {
        prisma.orgMembershipProcess.findUnique
            .mockResolvedValueOnce(readyProcess)
            .mockResolvedValueOnce({ ...readyProcess, status: 'PENDING_PAYMENT' }); // post-tx re-read
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 0 });

        await advanceExternalIfComplete(20);

        expect(applyVolunteerStatus).not.toHaveBeenCalled();
        expect(prisma.auditLog.create).not.toHaveBeenCalled();
        expect(notifyReviewers).not.toHaveBeenCalled();
    });

    it('not yet eligible (contract unsigned): returns early without touching anything', async () => {
        prisma.orgMembershipProcess.findUnique.mockResolvedValueOnce({ ...readyProcess, contractSignedAt: null });

        await advanceExternalIfComplete(20);

        expect(prisma.orgMembershipProcess.updateMany).not.toHaveBeenCalled();
        expect(applyVolunteerStatus).not.toHaveBeenCalled();
    });

    it('RENEWAL: consent alone advances — the contract gate is waived (no re-sign at renewal)', async () => {
        const renewal = { ...readyProcess, kind: 'RENEWAL', contractSignedAt: null };
        prisma.orgMembershipProcess.findUnique
            .mockResolvedValueOnce(renewal)
            .mockResolvedValueOnce({ ...renewal, status: 'PENDING_PAYMENT' });
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });

        await advanceExternalIfComplete(20);

        // The conditional update must not require contractSignedAt for a renewal.
        expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.not.objectContaining({ contractSignedAt: expect.anything() }),
                data: expect.objectContaining({ status: 'PENDING_PAYMENT' }),
            }),
        );
        expect(applyVolunteerStatus).toHaveBeenCalledWith(prisma, 42, 7, false);
        expect(notifyReviewers).toHaveBeenCalledTimes(1); // check not cleared → review needed
    });
});

describe('getOrCreateContractSigningUrl', () => {
    const pendingProcess = { id: 20, status: 'PENDING_EXTERNAL_ACTION', zohoEnvelopeId: null, zohoActionId: null };
    const leadUser = {
        id: 1,
        householdId: 7,
        isSysadmin: false,
        email: 'lead@example.com',
        name: 'Lead Person',
        isHouseholdLead: true,
        household: { orgMembership: { processes: [pendingProcess] } },
    };

    it('not_configured when Zoho is unavailable', async () => {
        config.zohoAvailable.mockReturnValue(false);
        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'not_configured' });
        expect(prisma.person.findUnique).not.toHaveBeenCalled();
    });

    it('not_found when the user does not exist', async () => {
        prisma.person.findUnique.mockResolvedValue(null);
        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'not_found' });
    });

    it('no_household when the user has no household', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...leadUser, householdId: null });
        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'no_household' });
    });

    it('not_lead when the caller is not a household lead and not a sysadmin', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...leadUser, isHouseholdLead: false });
        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'not_lead' });
    });

    it('wrong_phase when there is no process awaiting external action', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...leadUser, household: { orgMembership: { processes: [] } } });
        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'wrong_phase' });
    });

    it('mock mode: skips loadAgreementPdf/stampWatermark and creates + submits + embeds', async () => {
        prisma.person.findUnique.mockResolvedValue(leadUser);
        zohoSign.getAccessToken.mockResolvedValue('token-1');
        zohoSign.createRequest.mockResolvedValue({ requestId: 'req-1', actionId: 'act-1', documentId: 'doc-1' });
        zohoSign.submitRequest.mockResolvedValue(undefined);
        zohoSign.getEmbeddedSignUrl.mockResolvedValue('https://sign.example/embed');
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });

        const url = await getOrCreateContractSigningUrl(1);

        expect(loadAgreementPdf).not.toHaveBeenCalled();
        expect(stampWatermark).not.toHaveBeenCalled();
        expect(zohoSign.createRequest).toHaveBeenCalledTimes(1);
        expect(zohoSign.submitRequest).toHaveBeenCalledTimes(1);
        expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
        expect(url).toBe('https://sign.example/embed');
    });

    it('already claimed ids → skips create/submit and goes straight to the embed URL', async () => {
        prisma.person.findUnique.mockResolvedValue({
            ...leadUser,
            household: { orgMembership: { processes: [{ ...pendingProcess, zohoEnvelopeId: 'req-existing', zohoActionId: 'act-existing' }] } },
        });
        zohoSign.getAccessToken.mockResolvedValue('token-1');
        zohoSign.getRequestStatus.mockResolvedValue('in_progress');
        zohoSign.getEmbeddedSignUrl.mockResolvedValue('https://sign.example/embed-existing');

        const url = await getOrCreateContractSigningUrl(1);

        expect(zohoSign.createRequest).not.toHaveBeenCalled();
        expect(zohoSign.submitRequest).not.toHaveBeenCalled();
        expect(url).toBe('https://sign.example/embed-existing');
    });

    it('dead stored request (declined/expired) → clears the ids and creates a fresh one (#876)', async () => {
        prisma.person.findUnique.mockResolvedValue({
            ...leadUser,
            household: { orgMembership: { processes: [{ ...pendingProcess, zohoEnvelopeId: 'req-dead', zohoActionId: 'act-dead' }] } },
        });
        zohoSign.getAccessToken.mockResolvedValue('token-1');
        zohoSign.getRequestStatus.mockResolvedValue('terminal');
        zohoSign.createRequest.mockResolvedValue({ requestId: 'req-fresh', actionId: 'act-fresh', documentId: 'doc-fresh' });
        zohoSign.getEmbeddedSignUrl.mockResolvedValue('https://sign.example/embed-fresh');
        prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma));
        prisma.orgMembershipProcess.updateMany.mockResolvedValue({ count: 1 });

        const url = await getOrCreateContractSigningUrl(1);

        // The dead pair is forgotten (conditional on still pointing at it)…
        expect(prisma.orgMembershipProcess.updateMany).toHaveBeenCalledWith({
            where: { id: 20, zohoEnvelopeId: 'req-dead', contractSignedAt: null },
            data: { zohoEnvelopeId: null, zohoActionId: null },
        });
        // …and a fresh request is created and embedded.
        expect(zohoSign.createRequest).toHaveBeenCalledTimes(1);
        expect(zohoSign.getEmbeddedSignUrl).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-fresh', actionId: 'act-fresh' }));
        expect(url).toBe('https://sign.example/embed-fresh');
    });

    it('status check failure → falls back to embedding the stored request (best-effort)', async () => {
        prisma.person.findUnique.mockResolvedValue({
            ...leadUser,
            household: { orgMembership: { processes: [{ ...pendingProcess, zohoEnvelopeId: 'req-existing', zohoActionId: 'act-existing' }] } },
        });
        zohoSign.getAccessToken.mockResolvedValue('token-1');
        zohoSign.getRequestStatus.mockRejectedValue(new Error('Zoho 503'));
        zohoSign.getEmbeddedSignUrl.mockResolvedValue('https://sign.example/embed-existing');

        const url = await getOrCreateContractSigningUrl(1);

        expect(zohoSign.createRequest).not.toHaveBeenCalled();
        expect(url).toBe('https://sign.example/embed-existing');
    });

    it('non-mock mode: AgreementUnavailableError maps to an agreement_unavailable ExternalError', async () => {
        config.zohoMockActive.mockReturnValue(false);
        prisma.person.findUnique.mockResolvedValue(leadUser);
        zohoSign.getAccessToken.mockResolvedValue('token-1');
        loadAgreementPdf.mockRejectedValue(new AgreementUnavailableError('no pdf yet'));

        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'agreement_unavailable' });
    });
});
