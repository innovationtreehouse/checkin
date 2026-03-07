/**
 * @jest-environment node
 */
/**
 * Integration Tests for Eligible Participants API
 * Tests GET /api/programs/[id]/eligible-participants for fetching candidates
 */

import { GET } from '@/app/api/programs/[id]/eligible-participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';

// Mock NextAuth
jest.mock('next-auth', () => ({
    getServerSession: jest.fn()
}));
jest.mock('@/app/api/auth/[...nextauth]/route', () => ({
    authOptions: {}
}));

describe('Eligible Participants API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    
    let activeMemberId: number;
    let householdMemberId: number;
    let nonMemberId: number;
    let alreadyEnrolledId: number;

    let publicProgramId: number;
    let memberOnlyProgramId: number;
    let testHouseholdId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.participant.findMany({
            where: { email: { contains: 'elig-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.programParticipant.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.membership.deleteMany({
             where: { volunteerId: { in: existingUserIds } }
        });

        await prisma.household.deleteMany({
             where: { participants: { some: { id: { in: existingUserIds } } } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Elig API Test' } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.participant.create({
            data: { email: 'admin-elig-api-test@example.com', name: 'Admin', sysadmin: true }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.participant.create({
            data: { email: 'lead-elig-api-test@example.com', name: 'Lead' }
        });
        leadId = lead.id;

        // Create Common User
        const commonUser = await prisma.participant.create({
            data: { email: 'common-elig-api-test@example.com', name: 'Common' }
        });
        commonId = commonUser.id;

        // Create Active Member
        const activeMember = await prisma.participant.create({
            data: { 
                email: 'active-member-elig-api-test@example.com', 
                name: 'Active Member Candidate',
                memberships: {
                    create: {
                        type: 'HOUSEHOLD',
                        active: true,
                        since: new Date()
                    }
                }
            }
        });
        activeMemberId = activeMember.id;

        // Create Household Member (indirect membership)
        const household = await prisma.household.create({
            data: {
                name: 'Elig API Test Household',
                memberships: {
                    create: {
                        type: 'HOUSEHOLD',
                        active: true,
                        since: new Date()
                    }
                }
            }
        });
        testHouseholdId = household.id;

        const householdMember = await prisma.participant.create({
            data: { 
                email: 'household-member-elig-api-test@example.com', 
                name: 'Household Member Candidate',
                householdId: household.id
            }
        });
        householdMemberId = householdMember.id;

        // Create Non-Member
        const nonMember = await prisma.participant.create({
            data: { 
                email: 'non-member-elig-api-test@example.com', 
                name: 'Non Member Candidate'
            }
        });
        nonMemberId = nonMember.id;

        // Create mock programs
        const publicProgram = await prisma.program.create({
            data: { name: 'Public Elig API Test', phase: 'RUNNING', memberOnly: false, leadMentorId: leadId }
        });
        publicProgramId = publicProgram.id;

        const memberOnlyProgram = await prisma.program.create({
            data: { name: 'Member Only Elig API Test', phase: 'RUNNING', memberOnly: true, leadMentorId: leadId }
        });
        memberOnlyProgramId = memberOnlyProgram.id;

        // Create already enrolled participant for public program
        const alreadyEnrolled = await prisma.participant.create({
            data: { 
                email: 'enrolled-elig-api-test@example.com', 
                name: 'Already Enrolled Candidate',
                programParticipants: {
                    create: {
                        programId: publicProgramId
                    }
                }
            }
        });
        alreadyEnrolledId = alreadyEnrolled.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, activeMemberId, householdMemberId, nonMemberId, alreadyEnrolledId].filter(id => id !== undefined);
        const validProgramIds = [publicProgramId, memberOnlyProgramId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });

            await prisma.membership.deleteMany({
                 where: { OR: [{ householdId: { not: null } }, { volunteerId: { in: existingUserIds } }] }
            });
        }

        if (existingUserIds.length > 0) {
            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }

        if (testHouseholdId) {
            await prisma.householdLead.deleteMany({
                where: { householdId: testHouseholdId }
            });
            await prisma.household.deleteMany({
                where: { id: testHouseholdId }
            });
        }

        if (validProgramIds.length > 0) {
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
    });

    // Helper function to mock Next.js App Router params
    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });
    const createReq = (id: number, search: string = '') => {
        return {
            nextUrl: new URL(`http://localhost:4000/api/programs/${id}/eligible-participants${search ? `?q=${encodeURIComponent(search)}` : ''}`),
            method: 'GET'
        } as any;
    };

    describe('GET /api/programs/[id]/eligible-participants', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const res = await GET(createReq(publicProgramId), createParams(publicProgramId));
             expect(res.status).toBe(401);
        });

        it('should return 404 Not Found for non-existent program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const res = await GET(createReq(999999), createParams(999999));
             expect(res.status).toBe(404);
        });

        it('should block common users from accessing the list', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const res = await GET(createReq(publicProgramId), createParams(publicProgramId));
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow lead mentors to retrieve candidates not currently enrolled', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const res = await GET(createReq(publicProgramId, 'Candidate'), createParams(publicProgramId));
             expect(res.status).toBe(200);
             
             const data = await res.json();
             // Should fetch nonMember, activeMember, and householdMember, but NOT alreadyEnrolled
             const names = data.members.map((m: any) => m.name);
             
             expect(names).toContain('Active Member Candidate');
             expect(names).toContain('Household Member Candidate');
             expect(names).toContain('Non Member Candidate');
             expect(names).not.toContain('Already Enrolled Candidate');
        });

        it('should filter candidates by query string via name', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const res = await GET(createReq(publicProgramId, 'Active'), createParams(publicProgramId));
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.members.length).toBe(1);
             expect(data.members[0].name).toBe('Active Member Candidate');
        });

        it('should filter candidates by query string via email', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });

             const res = await GET(createReq(publicProgramId, 'non-member-elig'), createParams(publicProgramId));
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.members.length).toBe(1);
             expect(data.members[0].name).toBe('Non Member Candidate');
        });

        it('should strictly limit candidates for memberOnly programs to members and household members', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const res = await GET(createReq(memberOnlyProgramId, 'Candidate'), createParams(memberOnlyProgramId));
             expect(res.status).toBe(200);
             
             const data = await res.json();
             const names = data.members.map((m: any) => m.name);
             
             expect(names).toContain('Active Member Candidate'); // Individual member
             expect(names).toContain('Household Member Candidate'); // Under household member
             
             // The non-member should be excluded entirely
             expect(names).not.toContain('Non Member Candidate');
        });
    });
});
