/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * @jest-environment node
 */
/**
 * Integration Tests for Waitlist Features
 * Tests Join Waitlist, Admin Offer Spot, and Enrolling from Offered Spot
 */

import { POST as EnrollPOST } from '@/app/api/programs/[id]/participants/route';
import { POST as OfferPOST } from '@/app/api/programs/[id]/participants/[participantId]/offer/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { sendNotification } from '@/lib/notifications';

// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
// Mock Notifications
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('Waitlist API Integration Tests', () => {
    let leadId: number;
    let commonId: number;
    let waitlistUserId: number;
    
    let fullProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'waitlist-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.programParticipant.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Waitlist API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-waitlist-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        // Create Common User (Occupying the only spot)
        const commonUser = await prisma.participant.create({
            data: { 
                email: 'common-waitlist-api-test@example.com', 
                name: 'Common'
            }
        });
        commonId = commonUser.id;

        // Create Waitlist User
        const waitlistUser = await prisma.participant.create({
            data: { 
                email: 'waitlist-user-api-test@example.com', 
                name: 'Waitlister'
            }
        });
        waitlistUserId = waitlistUser.id;

        // Create a capped program and pre-fill it to its capacity (1 participant)
        const fullProgram = await prisma.program.create({
            data: { 
                name: 'Full Waitlist API Test', 
                phase: 'RUNNING', 
                enrollmentStatus: 'OPEN',
                maxParticipants: 1,
                leadMentorId: leadId,
                participants: {
                    create: { participantId: commonId, status: 'ACTIVE' }
                }
            }
        });
        fullProgramId = fullProgram.id;
    });

    afterAll(async () => {
        const existingUserIds = [leadId, commonId, waitlistUserId].filter(id => id !== undefined);
        const validProgramIds = [fullProgramId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
        }

        if (validProgramIds.length > 0) {
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
        
        if (existingUserIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });

            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });
    const createOfferParams = (id: number, pId: number) => ({ params: Promise.resolve({ id: id.toString(), participantId: pId.toString() }) });

    describe('Waitlist Flow', () => {
        it('should join the waitlist successfully bypassing capacity', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: waitlistUserId } });

             // Regular enrollment fails due to capacity
             const reqFail = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: waitlistUserId })
             });
             const resFail = await EnrollPOST(reqFail as any, createParams(fullProgramId) as any);
             expect(resFail.status).toBe(400);

             // Waitlist enrollment succeeds
             const reqSuccess = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: waitlistUserId, joiningWaitlist: true })
             });
             const resSuccess = await EnrollPOST(reqSuccess as any, createParams(fullProgramId) as any);
             expect(resSuccess.status).toBe(200);
             
             const data = await resSuccess.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.status).toBe('WAITLISTED');
        });

        it('should allow the program lead to offer a spot', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants/${waitlistUserId}/offer`, {
                 method: 'POST'
             });
             const res = await OfferPOST(req as any, createOfferParams(fullProgramId, waitlistUserId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.status).toBe('OFFERED');

             // Verify Notification was sent
             expect(sendNotification).toHaveBeenCalledWith(
                 waitlistUserId, 
                 'WAITLIST_OFFER', 
                 expect.objectContaining({ programId: fullProgramId })
             );
        });
        
        it('should allow an offered participant to self-enroll normally (upgrading status to PENDING)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: waitlistUserId } });

             // They try to enroll normally (without joiningWaitlist flag)
             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: waitlistUserId })
             });
             const res = await EnrollPOST(req as any, createParams(fullProgramId) as any);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.status).toBe('PENDING'); // Upgraded status!
        });
    });
});
