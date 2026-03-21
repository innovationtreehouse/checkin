import { POST as ParticipantPost } from '@/app/api/programs/[id]/participants/route';
import { POST as ShopifyWebhook } from '@/app/api/webhooks/shopify/route';
import { GET as CronPending } from '@/app/api/cron/pending-participants/route';
import prisma from '@/lib/prisma';
import crypto from 'crypto';

// Generic mock implementation
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockGetSession = require('next-auth/next').getServerSession;

describe('Program Lifecycle Integration Tests', () => {
    let testProgramId: number;
    let testParticipantId: number;
    let leadMentorId: number;
    let boardAdminId: number;

    beforeAll(async () => {
        // Setup initial db state for test scope
        
        // 1. Create a board member
        const adminUser = await prisma.participant.create({
            data: {
                name: "Board Tester",
                email: "board@test.com",
                googleId: "test-auth-board",
                sysadmin: false,
                boardMember: true,
                dob: new Date('1990-01-01')
            }
        });
        boardAdminId = adminUser.id;

        // 2. Create a Lead Mentor
        const mentorUser = await prisma.participant.create({
            data: {
                name: "Mentor Tester",
                email: "mentor@test.com",
                googleId: "test-auth-mentor",
                dob: new Date('1985-01-01')
            }
        });
        leadMentorId = mentorUser.id;

        // 3. Create a standard participant
        const standardUser = await prisma.participant.create({
            data: {
                name: "Standard Tester",
                email: "participant@test.com",
                googleId: "test-auth-std",
                dob: new Date('2000-01-01')
            }
        });
        testParticipantId = standardUser.id;

        // 4. Create a program
        const program = await prisma.program.create({
            data: {
                name: "Integration Test Program",
                leadMentorId,
                memberPrice: 50,
                nonMemberPrice: 100,
                shopifyProductId: "test-prod",
                shopifyMemberVariantId: "test-mem-var",
                shopifyNonMemberVariantId: "test-non-var",
                enrollmentStatus: "OPEN"
            }
        });
        testProgramId = program.id;
    });

    afterAll(async () => {
        // Teardown
        if (testProgramId) {
            await prisma.programParticipant.deleteMany({ where: { programId: testProgramId } });
            await prisma.program.delete({ where: { id: testProgramId } });
        }

        const idsToDelete = [testParticipantId, leadMentorId, boardAdminId].filter(id => id);
        if (idsToDelete.length > 0) {
            await prisma.participant.deleteMany({ where: { id: { in: idsToDelete } } });
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('Should allow Self-Enrollment and set status to PENDING', async () => {
        // Mock standard user logged in
        mockGetSession.mockResolvedValue({ user: { id: testParticipantId } });

        const req = new Request(`http://localhost/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: testParticipantId })
        });

        const res = await ParticipantPost(req, { params: Promise.resolve({ id: String(testProgramId) }) });
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.success).toBe(true);

        const dbRecord = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId: testProgramId, participantId: testParticipantId } }
        });
        
        expect(dbRecord).toBeDefined();
        expect(dbRecord?.status).toBe('PENDING');
        expect(dbRecord?.pendingSince).toBeInstanceOf(Date);
        expect(dbRecord?.paymentPlanRequested).toBe(false);
    });

    it('Should block Lead Mentors from manually adding participants', async () => {
         mockGetSession.mockResolvedValue({ user: { id: leadMentorId } });

        const req = new Request(`http://localhost/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: testParticipantId }) // Adding someone else
        });

        const res = await ParticipantPost(req, { params: Promise.resolve({ id: String(testProgramId) }) });
        expect(res.status).toBe(403);
    });

    it('Should require a Board Member to supply override=true when bypassing payment flows', async () => {
        mockGetSession.mockResolvedValue({ user: { id: boardAdminId, boardMember: true } });

        const req = new Request(`http://localhost/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: testParticipantId }) // No override flag
        });

        const res = await ParticipantPost(req, { params: Promise.resolve({ id: String(testProgramId) }) });
        expect(res.status).toBe(400);
        
        const data = await res.json();
        expect(data.requiresOverride).toBe(true);
    });

    it('Should allow a Board Member to override and add a participant, defaulting to ACTIVE', async () => {
        mockGetSession.mockResolvedValue({ user: { id: boardAdminId, boardMember: true } });

        // Clean previous runs
        await prisma.programParticipant.deleteMany({ where: { programId: testProgramId, participantId: testParticipantId } });

        const req = new Request(`http://localhost/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: testParticipantId, override: true })
        });

        const res = await ParticipantPost(req, { params: Promise.resolve({ id: String(testProgramId) }) });
        expect(res.status).toBe(200);

        const dbRecord = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId: testProgramId, participantId: testParticipantId } }
        });
        
        // Overrides by board default to ACTIVE
        expect(dbRecord?.status).toBe('ACTIVE'); 
    });

    it('Shopify Webhook should mark a PENDING participant as ACTIVE', async () => {
        // 1. Reset user to PENDING state manually to simulate self-enroll flow
        // First, recreate or ensure it exists from the previous test
        await prisma.programParticipant.upsert({
            where: { programId_participantId: { programId: testProgramId, participantId: testParticipantId } },
            update: { status: 'PENDING', pendingSince: new Date() },
            create: { programId: testProgramId, participantId: testParticipantId, status: 'PENDING', pendingSince: new Date() }
        });

        // 2. Build Shopify webhook payload
        const payload = JSON.stringify({
            id: 12345,
            note_attributes: [
                { name: "CheckMeIn_Account_ID", value: String(testParticipantId) },
                { name: "Program_ID", value: String(testProgramId) }
            ]
        });

        process.env.SHOPIFY_WEBHOOK_SECRET = 'test_secret';
        
        const hmac = crypto.createHmac('sha256', 'test_secret').update(payload, 'utf8').digest('base64');

        const req = new Request(`http://localhost/api/webhooks/shopify`, {
            method: 'POST',
            headers: {
                'x-shopify-hmac-sha256': hmac,
                'Content-Type': 'application/json'
            },
            body: payload
        });

        const res = await ShopifyWebhook(req);
        expect(res.status).toBe(200);

        const dbRecord = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId: testProgramId, participantId: testParticipantId } }
        });
        
        expect(dbRecord?.status).toBe('ACTIVE'); 
        expect(dbRecord?.pendingSince).toBeNull(); 
    });

     it('Cron job should remove PENDING participants after 7 days, unless paymentPlanRequested is true', async () => {
        process.env.CRON_SECRET = 'cron_test_secret';

        // 1. Set user to 8 days old PENDING
        const eightDaysAgo = new Date();
        eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

        await prisma.programParticipant.upsert({
             where: { programId_participantId: { programId: testProgramId, participantId: testParticipantId } },
             update: { status: 'PENDING', pendingSince: eightDaysAgo, paymentPlanRequested: false },
             create: { programId: testProgramId, participantId: testParticipantId, status: 'PENDING', pendingSince: eightDaysAgo, paymentPlanRequested: false }
        });

        let req = new Request(`http://localhost/api/cron/pending-participants`, {
            headers: { 'authorization': `Bearer cron_test_secret` }
        });

        let res = await CronPending(req);
        let data = await res.json();
        
        expect(res.status).toBe(200);
        expect(data.kicked).toBe(1);

        // Verify Delete
        let dbRecord = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId: testProgramId, participantId: testParticipantId } }
        });
        expect(dbRecord).toBeNull();

        // 2. Recreate, set to 8 days old PENDING, but paymentPlanRequested = true
        await prisma.programParticipant.create({
            data: { programId: testProgramId, participantId: testParticipantId, status: 'PENDING', pendingSince: eightDaysAgo, paymentPlanRequested: true}
        });

         req = new Request(`http://localhost/api/cron/pending-participants`, {
            headers: { 'authorization': `Bearer cron_test_secret` }
        });

        res = await CronPending(req);
        data = await res.json();
        expect(res.status).toBe(200);
        expect(data.kicked).toBe(0); // Should be saved!

         // Verify Still there
        dbRecord = await prisma.programParticipant.findUnique({
            where: { programId_participantId: { programId: testProgramId, participantId: testParticipantId } }
        });
        expect(dbRecord).toBeDefined();
    });
});
