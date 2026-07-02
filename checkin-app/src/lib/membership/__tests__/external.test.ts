/**
 * @jest-environment node
 */
/**
 * Unit tests for external.ts (prisma + config + zoho provider mocked, no DB):
 *   - setZohoEnvelope / findProcessByEnvelope: simple prisma passthroughs.
 *   - getOrCreateContractSigningUrl: the guard chain (not_configured/not_found/
 *     no_household/not_lead/wrong_phase), the mock-mode PDF short-circuit, and
 *     the already-claimed-ids short-circuit.
 */
import { setZohoEnvelope, findProcessByEnvelope, getOrCreateContractSigningUrl, ExternalError } from '@/lib/membership/external';

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: { findUnique: jest.fn() },
        membershipProcess: { findUnique: jest.fn(), update: jest.fn(), findFirst: jest.fn(), updateMany: jest.fn() },
        auditLog: { create: jest.fn() },
    },
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

beforeEach(() => {
    jest.clearAllMocks();
    config.zohoAvailable.mockReturnValue(true);
    config.zohoMockActive.mockReturnValue(true);
    config.isProd.mockReturnValue(false);
    config.baseUrl.mockReturnValue('https://checkin.example.org');
});

describe('setZohoEnvelope', () => {
    it('not_found when the process does not exist', async () => {
        prisma.membershipProcess.findUnique.mockResolvedValue(null);
        await expect(setZohoEnvelope(1, 'req-1', 5)).rejects.toBeInstanceOf(ExternalError);
    });

    it('updates the envelope id and writes an audit row', async () => {
        prisma.membershipProcess.findUnique.mockResolvedValue({ id: 1 });
        prisma.membershipProcess.update.mockResolvedValue({ id: 1, zohoEnvelopeId: 'req-1' });

        const result = await setZohoEnvelope(1, 'req-1', 5);

        expect(prisma.membershipProcess.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { zohoEnvelopeId: 'req-1' } });
        expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ id: 1, zohoEnvelopeId: 'req-1' });
    });
});

describe('findProcessByEnvelope', () => {
    it('looks up the process by zohoEnvelopeId', async () => {
        prisma.membershipProcess.findFirst.mockResolvedValue({ id: 9 });
        const result = await findProcessByEnvelope('req-9');
        expect(prisma.membershipProcess.findFirst).toHaveBeenCalledWith({ where: { zohoEnvelopeId: 'req-9' } });
        expect(result).toEqual({ id: 9 });
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
        householdLeads: [{ householdId: 7 }],
        household: { membership: { processes: [pendingProcess] } },
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
        prisma.person.findUnique.mockResolvedValue({ ...leadUser, householdLeads: [] });
        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'not_lead' });
    });

    it('wrong_phase when there is no process awaiting external action', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...leadUser, household: { membership: { processes: [] } } });
        await expect(getOrCreateContractSigningUrl(1)).rejects.toMatchObject({ code: 'wrong_phase' });
    });

    it('mock mode: skips loadAgreementPdf/stampWatermark and creates + submits + embeds', async () => {
        prisma.person.findUnique.mockResolvedValue(leadUser);
        zohoSign.getAccessToken.mockResolvedValue('token-1');
        zohoSign.createRequest.mockResolvedValue({ requestId: 'req-1', actionId: 'act-1', documentId: 'doc-1' });
        zohoSign.submitRequest.mockResolvedValue(undefined);
        zohoSign.getEmbeddedSignUrl.mockResolvedValue('https://sign.example/embed');
        prisma.membershipProcess.updateMany.mockResolvedValue({ count: 1 });

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
            household: { membership: { processes: [{ ...pendingProcess, zohoEnvelopeId: 'req-existing', zohoActionId: 'act-existing' }] } },
        });
        zohoSign.getAccessToken.mockResolvedValue('token-1');
        zohoSign.getEmbeddedSignUrl.mockResolvedValue('https://sign.example/embed-existing');

        const url = await getOrCreateContractSigningUrl(1);

        expect(zohoSign.createRequest).not.toHaveBeenCalled();
        expect(zohoSign.submitRequest).not.toHaveBeenCalled();
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
