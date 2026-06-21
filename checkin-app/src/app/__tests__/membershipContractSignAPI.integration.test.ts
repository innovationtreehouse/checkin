/**
 * @jest-environment node
 */
/**
 * Integration tests for POST /api/membership/contract/sign — the applicant-facing
 * "Sign your membership agreement" action. The Zoho client and the agreement-PDF
 * loader are mocked (no real Zoho calls / no PDF on disk); the DB and the
 * idempotent create-and-store logic are exercised for real.
 */

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import * as zoho from '@/lib/membership/contract/zohoClient';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/membership/contract/agreementDocument', () => ({
    ...jest.requireActual('@/lib/membership/contract/agreementDocument'),
    loadAgreementPdf: jest.fn().mockResolvedValue({ pdf: Buffer.from('%PDF-1.4'), lastPageNo: 0, pageWidth: 612, pageHeight: 792 }),
}));
jest.mock('@/lib/membership/contract/zohoClient', () => ({
    ZohoError: class ZohoError extends Error {},
    getAccessToken: jest.fn().mockResolvedValue('tok'),
    createRequest: jest.fn().mockResolvedValue({ requestId: 'REQ-1', actionId: 'ACT-1', documentId: 'DOC-1' }),
    submitRequest: jest.fn().mockResolvedValue(undefined),
    getEmbeddedSignUrl: jest.fn().mockResolvedValue('https://sign.zoho.com/embed/xyz'),
}));

// Imported AFTER the mocks so the route picks up the mocked client.
import { POST as SIGN } from '@/app/api/membership/contract/sign/route';

const TAG = 'contract-sign-test';

function asUser(id: number) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: false, boardMember: false } });
}
function signReq() {
    return new Request('http://localhost:4000/api/membership/contract/sign', { method: 'POST' }) as unknown as Parameters<typeof SIGN>[0];
}

describe('POST /api/membership/contract/sign', () => {
    let leadId: number;
    let nonLeadId: number;
    let processId: number;
    const prevEnv = { id: process.env.ZOHO_CLIENT_ID, secret: process.env.ZOHO_CLIENT_SECRET, refresh: process.env.ZOHO_REFRESH_TOKEN };

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.auditLog.deleteMany({ where: { tableName: 'MembershipProcess', affectedEntityId: { in: ids } } }).catch(() => {});
            await prisma.membershipProcess.deleteMany({ where: { membership: { householdId: { in: ids } } } });
            await prisma.membership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
    }

    beforeAll(async () => {
        process.env.ZOHO_CLIENT_ID = 'cid';
        process.env.ZOHO_CLIENT_SECRET = 'csecret';
        process.env.ZOHO_REFRESH_TOKEN = 'rtoken';
        await wipe();

        const hh = await prisma.household.create({ data: { name: `HH ${TAG}` } });
        const lead = await prisma.participant.create({ data: { email: `lead-${TAG}@example.com`, name: 'Lead Parent', householdId: hh.id } });
        const nonLead = await prisma.participant.create({ data: { email: `member-${TAG}@example.com`, name: 'Member', householdId: hh.id } });
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: lead.id } });
        const m = await prisma.membership.create({ data: { householdId: hh.id, status: 'NONE' } });
        const proc = await prisma.membershipProcess.create({ data: { membershipId: m.id, kind: 'INITIAL', status: 'PENDING_EXTERNAL_ACTION' } });
        leadId = lead.id;
        nonLeadId = nonLead.id;
        processId = proc.id;
    });

    afterAll(async () => {
        await wipe();
        process.env.ZOHO_CLIENT_ID = prevEnv.id;
        process.env.ZOHO_CLIENT_SECRET = prevEnv.secret;
        process.env.ZOHO_REFRESH_TOKEN = prevEnv.refresh;
        await prisma.$disconnect();
    });

    beforeEach(() => jest.clearAllMocks());

    it('rejects a non-lead household member', async () => {
        asUser(nonLeadId);
        const res = await SIGN(signReq());
        expect(res.status).toBe(403);
        expect(zoho.createRequest).not.toHaveBeenCalled();
    });

    it('creates the Zoho request once, stores the ids, and returns the embed url', async () => {
        asUser(leadId);
        const res = await SIGN(signReq());
        expect(res.status).toBe(200);
        expect((await res.json()).url).toBe('https://sign.zoho.com/embed/xyz');
        expect(zoho.createRequest).toHaveBeenCalledTimes(1);
        // PrintedName is prefilled from the applicant's name.
        expect((zoho.submitRequest as jest.Mock).mock.calls[0][0].prefill).toEqual({ PrintedName: 'Lead Parent' });
        const p = await prisma.membershipProcess.findUnique({ where: { id: processId } });
        expect(p?.zohoEnvelopeId).toBe('REQ-1');
        expect(p?.zohoActionId).toBe('ACT-1');
    });

    it('is idempotent: a second click reuses the stored request, only minting a fresh url', async () => {
        asUser(leadId);
        const res = await SIGN(signReq());
        expect(res.status).toBe(200);
        expect(zoho.createRequest).not.toHaveBeenCalled(); // already created last test
        expect(zoho.getEmbeddedSignUrl).toHaveBeenCalledTimes(1);
        const p = await prisma.membershipProcess.findUnique({ where: { id: processId } });
        expect(p?.zohoEnvelopeId).toBe('REQ-1'); // unchanged
    });

    it('409s when the application is not in the EXTERNAL phase', async () => {
        await prisma.membershipProcess.update({ where: { id: processId }, data: { status: 'INTAKE' } });
        asUser(leadId);
        const res = await SIGN(signReq());
        expect(res.status).toBe(409);
        await prisma.membershipProcess.update({ where: { id: processId }, data: { status: 'PENDING_EXTERNAL_ACTION' } });
    });

    it('503s when Zoho is not configured', async () => {
        delete process.env.ZOHO_CLIENT_ID;
        asUser(leadId);
        const res = await SIGN(signReq());
        expect(res.status).toBe(503);
        process.env.ZOHO_CLIENT_ID = 'cid';
    });
});
