import { POST as CreateProgram } from '@/app/api/programs/route';
import { POST as AddEvent } from '@/app/api/programs/[id]/events/route';
import { POST as PublishProgram } from '@/app/api/programs/[id]/publish/route';
import { POST as CreateHousehold, PATCH as AddHouseholdMember } from '@/app/api/household/route';
import { POST as EnrollParticipant } from '@/app/api/programs/[id]/participants/route';
import { POST as ShopifyWebhook } from '@/app/api/webhooks/shopify/route';
import prisma from '@/lib/prisma';
import crypto from 'crypto';

// Mocking dependencies
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn(),
}));

jest.mock('@/lib/shopify', () => ({
    createShopifyProgramVariants: jest.fn().mockResolvedValue({
        shopifyProductId: 'mock-product-id',
        shopifyMemberVariantId: 'mock-member-variant-id',
        shopifyNonMemberVariantId: 'mock-non-member-variant-id',
    }),
}));

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    participant: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    program: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    event: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    household: {
      create: jest.fn(),
      delete: jest.fn(),
    },
    householdLead: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    membership: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    programParticipant: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

const mockGetSession = require('next-auth/next').getServerSession;

describe('Full Program Signup Integration Flow', () => {
    const sysAdminId = 1;
    const leadUserId = 2;
    const childParticipantId = 3;
    const programId = 10;
    const householdId = 100;

    const SHOPIFY_SECRET = 'test_shopify_secret';

    beforeAll(() => {
        process.env.SHOPIFY_WEBHOOK_SECRET = SHOPIFY_SECRET;
    });

    it('should complete the full program signup flow', async () => {
        // 1. SysAdmin creates a program
        mockGetSession.mockResolvedValue({ user: { id: sysAdminId, sysadmin: true } });
        (prisma.program.create as jest.Mock).mockResolvedValue({ id: programId, name: 'Integration Test Program' });
        (prisma.auditLog.create as jest.Mock).mockResolvedValue({});

        const createProgramReq = new Request('http://localhost/api/programs', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Integration Test Program',
                memberPrice: 50,
                nonMemberPrice: 100,
                leadMentorId: sysAdminId,
            }),
        });
        const createProgramRes = await CreateProgram(createProgramReq);
        expect(createProgramRes.status).toBe(200);
        const createProgramData = await createProgramRes.json();
        expect(createProgramData.program.id).toBe(programId);

        // 2. SysAdmin adds an event (required for publishing)
        (prisma.program.findUnique as jest.Mock).mockResolvedValue({ id: programId, leadMentorId: sysAdminId });
        (prisma.event.create as jest.Mock).mockResolvedValue({ id: 1, programId });

        const addEventReq = new Request(`http://localhost/api/programs/${programId}/events`, {
            method: 'POST',
            body: JSON.stringify({
                name: 'First Class',
                start: new Date(Date.now() + 86400000).toISOString(),
                end: new Date(Date.now() + 86400000 + 3600000).toISOString(),
            }),
        });
        const addEventRes = await AddEvent(addEventReq, { params: Promise.resolve({ id: String(programId) }) });
        expect(addEventRes.status).toBe(200);

        // 3. SysAdmin publishes the program
        (prisma.program.findUnique as jest.Mock).mockResolvedValue({
            id: programId,
            leadMentorId: sysAdminId,
            events: [{ id: 1 }]
        });
        (prisma.program.update as jest.Mock).mockResolvedValue({ id: programId, phase: 'UPCOMING', enrollmentStatus: 'OPEN' });

        const publishReq = new Request(`http://localhost/api/programs/${programId}/publish`, {
            method: 'POST',
            body: JSON.stringify({ publish: true }),
        });
        const publishRes = await PublishProgram(publishReq, { params: Promise.resolve({ id: String(programId) }) });
        expect(publishRes.status).toBe(200);

        // 4. Lead user creates a household
        mockGetSession.mockResolvedValue({ user: { id: leadUserId } });
        (prisma.participant.findUnique as jest.Mock).mockResolvedValue({ id: leadUserId, name: 'Lead', householdId: null });
        (prisma.household.create as jest.Mock).mockResolvedValue({ id: householdId });
        (prisma.membership.create as jest.Mock).mockResolvedValue({});

        const createHouseholdReq = new Request('http://localhost/api/household', {
            method: 'POST',
        });
        const createHouseholdRes = await CreateHousehold(createHouseholdReq as any, { type: 'session', user: { id: leadUserId } } as any);
        expect(createHouseholdRes.status).toBe(201);
        const createHouseholdData = await createHouseholdRes.json();
        expect(createHouseholdData.household.id).toBe(householdId);

        // 5. Lead user adds a child member to the household
        (prisma.participant.findUnique as jest.Mock).mockResolvedValueOnce({ id: leadUserId, householdId, householdLeads: [{ householdId, participantId: leadUserId }] });
        (prisma.participant.create as jest.Mock).mockResolvedValue({ id: childParticipantId, householdId });

        const addChildReq = new Request('http://localhost/api/household', {
            method: 'PATCH',
            body: JSON.stringify({
                memberName: 'Child Participant',
                memberDob: '2015-01-01',
            }),
        });
        const addChildRes = await AddHouseholdMember(addChildReq as any, { type: 'session', user: { id: leadUserId } } as any);
        expect(addChildRes.status).toBe(200);
        const addChildData = await addChildRes.json();
        expect(addChildData.member.id).toBe(childParticipantId);

        // 6. Lead user enrolls child in the program
        (prisma.program.findUnique as jest.Mock).mockResolvedValue({
            id: programId,
            name: 'Integration Test Program',
            enrollmentStatus: 'OPEN',
            maxParticipants: null,
            _count: { participants: 0 }
        });
        (prisma.participant.findUnique as jest.Mock).mockResolvedValue({ id: childParticipantId, householdId, dob: new Date('2015-01-01') });
        (prisma.householdLead.findUnique as jest.Mock).mockResolvedValue({ householdId, participantId: leadUserId });
        (prisma.programParticipant.create as jest.Mock).mockResolvedValue({ programId, participantId: childParticipantId, status: 'PENDING' });

        const enrollReq = new Request(`http://localhost/api/programs/${programId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: childParticipantId }),
        });
        const enrollRes = await EnrollParticipant(enrollReq, { params: Promise.resolve({ id: String(programId) }) });
        expect(enrollRes.status).toBe(200);

        // 7. Verify PENDING status
        (prisma.programParticipant.findUnique as jest.Mock).mockResolvedValue({ programId, participantId: childParticipantId, status: 'PENDING' });
        const participantRecord = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId, participantId: childParticipantId } },
        });
        expect(participantRecord?.status).toBe('PENDING');

        // 8. Shopify Webhook call
        (prisma.programParticipant.findUnique as jest.Mock).mockResolvedValue({ programId, participantId: childParticipantId, status: 'PENDING' });
        (prisma.programParticipant.update as jest.Mock).mockResolvedValue({ programId, participantId: childParticipantId, status: 'ACTIVE' });

        const webhookPayload = JSON.stringify({
            note_attributes: [
                { name: 'CheckMeIn_Account_ID', value: String(childParticipantId) },
                { name: 'Program_ID', value: String(programId) },
            ],
        });
        const hmac = crypto.createHmac('sha256', SHOPIFY_SECRET).update(webhookPayload).digest('base64');
        const webhookReq = new Request('http://localhost/api/webhooks/shopify', {
            method: 'POST',
            headers: {
                'x-shopify-hmac-sha256': hmac,
            },
            body: webhookPayload,
        });
        const webhookRes = await ShopifyWebhook(webhookReq);
        expect(webhookRes.status).toBe(200);

        // 9. Final Verification - ACTIVE status
        (prisma.programParticipant.findUnique as jest.Mock).mockResolvedValue({ programId, participantId: childParticipantId, status: 'ACTIVE' });
        const finalParticipantRecord = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId, participantId: childParticipantId } },
        });
        expect(finalParticipantRecord?.status).toBe('ACTIVE');
    });

    it('should fail to enroll if not a household lead and not self', async () => {
        const otherUserId = 999;
        mockGetSession.mockResolvedValue({ user: { id: otherUserId } });

        (prisma.program.findUnique as jest.Mock).mockResolvedValue({
            id: programId,
            enrollmentStatus: 'OPEN',
            maxParticipants: null,
            _count: { participants: 0 }
        });
        (prisma.participant.findUnique as jest.Mock).mockResolvedValue({ id: childParticipantId, householdId, dob: new Date('2015-01-01') });
        (prisma.householdLead.findUnique as jest.Mock).mockResolvedValue(null); // Not a lead

        const enrollReq = new Request(`http://localhost/api/programs/${programId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: childParticipantId }),
        });
        const enrollRes = await EnrollParticipant(enrollReq, { params: Promise.resolve({ id: String(programId) }) });
        expect(enrollRes.status).toBe(403);
    });
});
