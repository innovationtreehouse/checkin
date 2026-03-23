/**
 * @jest-environment node
 */
/**
 * Integration Tests for Public Program Registration API
 * Tests POST /api/programs/[id]/public-register
 */

import { POST } from '@/app/api/programs/[id]/public-register/route';
import prisma from '@/lib/prisma';

// Mock Notifications
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn().mockResolvedValue(true)
}));

describe('Public Program Registration API Integration Tests', () => {
    let standardProgramId: number;
    let freeProgramId: number;
    let fullProgramId: number;
    let exactAgeProgramId: number;
    let existingParticipantId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const testEmails = ['test-primary-parent@example.com', 'existing-user-test@example.com'];
        const existingUsers = await prisma.participant.findMany({
            where: { email: { in: testEmails } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.programParticipant.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Public Reg Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });

        await prisma.householdLead.deleteMany({
            where: { participantId: { in: existingUserIds } }
        });
        
        await prisma.participant.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create an existing user to test unique email constraints
        const existingUser = await prisma.participant.create({
            data: { email: 'existing-user-test@example.com', name: 'Existing User' }
        });
        existingParticipantId = existingUser.id;

        // Create mock programs
        const standardProgram = await prisma.program.create({
            data: { 
                name: 'Standard Public Reg Test', 
                phase: 'RUNNING', 
                enrollmentStatus: 'OPEN', 
                memberPrice: 1000, 
                nonMemberPrice: 1500,
                shopifyNonMemberVariantId: '123456789'
            }
        });
        standardProgramId = standardProgram.id;

        const freeProgram = await prisma.program.create({
            data: { name: 'Free Public Reg Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', memberPrice: null, nonMemberPrice: null }
        });
        freeProgramId = freeProgram.id;

        const fullProgram = await prisma.program.create({
            data: { 
                name: 'Full Public Reg Test', 
                phase: 'RUNNING', 
                enrollmentStatus: 'OPEN',
                maxParticipants: 1,
                participants: {
                    create: { participantId: existingParticipantId } // Pre-fill
                }
            }
        });
        fullProgramId = fullProgram.id;

        const exactAgeProgram = await prisma.program.create({
            data: { name: 'Age Restricted Public Reg Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', minAge: 18, maxAge: 21 }
        });
        exactAgeProgramId = exactAgeProgram.id;
    });

    afterAll(async () => {
        const testEmails = ['test-primary-parent@example.com', 'existing-user-test@example.com'];
        const existingUsers = await prisma.participant.findMany({
            where: { email: { in: testEmails } },
            select: { id: true, householdId: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const householdIds = existingUsers.map(u => u.householdId).filter(id => id !== null) as number[];

        const validProgramIds = [standardProgramId, freeProgramId, fullProgramId, exactAgeProgramId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });
        }

        if (validProgramIds.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: { programId: { in: validProgramIds } }
            });
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
        
        if (existingUserIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });

            await prisma.householdLead.deleteMany({
                where: { participantId: { in: existingUserIds } }
            });

            await prisma.participant.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }

        if (householdIds.length > 0) {
            await prisma.household.deleteMany({
                where: { id: { in: householdIds } }
            });
        }
    });

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('POST /api/programs/[id]/public-register', () => {

        it('should block if primary parent is missing', async () => {
            const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/public-register`, {
                method: 'POST',
                body: JSON.stringify({
                    parents: [],
                    emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                    participants: [{ name: 'Timmy', dob: '2010-01-01' }]
                })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toMatch(/Primary parent/i);
        });

        it('should block if emergency phone matches parent phone', async () => {
            const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/public-register`, {
                method: 'POST',
                body: JSON.stringify({
                    parents: [{ name: 'Dad', email: 'dad@test.com', phone: '(555) 123-4567' }],
                    emergencyContact: { name: 'Aunt Sue', phone: '5551234567' }, // Same digits
                    participants: [{ name: 'Timmy', dob: '2010-01-01' }]
                })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toMatch(/Emergency contact phone must be different/i);
        });

        it('should block if parent email already exists', async () => {
            const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/public-register`, {
                method: 'POST',
                body: JSON.stringify({
                    parents: [{ name: 'Dad', email: 'existing-user-test@example.com', phone: '555-111-2222' }],
                    emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                    participants: [{ name: 'Timmy', dob: '2010-01-01' }]
                })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toMatch(/already exists/i);
        });

        it('should block if program is full', async () => {
            const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/public-register`, {
                method: 'POST',
                body: JSON.stringify({
                    parents: [{ name: 'Mom', email: 'mom1@test.com', phone: '555-111-2222' }],
                    emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                    participants: [{ name: 'Timmy', dob: '2010-01-01' }]
                })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toMatch(/open spots/i);
        });

        it('should block if participant does not meet age constraints', async () => {
            const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/public-register`, {
                method: 'POST',
                body: JSON.stringify({
                    parents: [{ name: 'Mom', email: 'mom2@test.com', phone: '555-111-2222' }],
                    emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                    participants: [{ name: 'Timmy', dob: '2015-01-01' }] // Under 18
                })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toMatch(/at least 18/i);
        });

        it('should successfully register a family with correct PENDING status and return Shopify URL', async () => {
            const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/public-register`, {
                method: 'POST',
                body: JSON.stringify({
                    parents: [{ name: 'Test Primary Parent', email: 'test-primary-parent@example.com', phone: '555-123-4444' }],
                    emergencyContact: { name: 'Aunt Sue', phone: '555-999-8888' },
                    participants: [
                        { name: 'Test Primary Parent' }, // implicitly matches parent by name
                        { name: 'Timmy Test', dob: '2010-05-05' }
                    ]
                })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
            expect(res.status).toBe(200);
            
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.checkoutUrl).toContain('123456789:2'); // Variant ID : quantity
            expect(data.checkoutUrl).toContain('CheckMeIn_Account_ID');
            expect(data.isFree).toBe(false);

            // Verify db
            const parent = await prisma.participant.findUnique({
                where: { email: 'test-primary-parent@example.com' },
                include: { householdLeads: true }
            });
            expect(parent).not.toBeNull();
            expect(parent?.householdLeads.length).toBe(1);

            const householdMembers = await prisma.participant.findMany({
                where: { householdId: parent?.householdId }
            });
            expect(householdMembers.length).toBe(2); // Parent + Child (no duplicates)

            const enrollments = await prisma.programParticipant.findMany({
                where: { programId: standardProgramId, participant: { householdId: parent?.householdId } }
            });
            expect(enrollments.length).toBe(2);
            expect(enrollments[0].status).toBe('PENDING');
        });

        it('should set status to ACTIVE if the program is free', async () => {
            // Need a new unique parent because the first one is already generated
            const uniqueEmail = `mom-free-${Date.now()}@test.com`;
            const req = new Request(`http://localhost:4000/api/programs/${freeProgramId}/public-register`, {
                method: 'POST',
                body: JSON.stringify({
                    parents: [{ name: 'Mom Free', email: uniqueEmail, phone: '555-111-3333' }],
                    emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                    participants: [{ name: 'Timmy', dob: '2010-01-01' }]
                })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, createParams(freeProgramId) as unknown as never);
            expect(res.status).toBe(200);
            
            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.checkoutUrl).toBeNull();
            expect(data.isFree).toBe(true);

            // Clean up the created one immediately for isolation
            const p = await prisma.participant.findUnique({ where: { email: uniqueEmail } });
            if (p) {
                await prisma.programParticipant.deleteMany({ where: { programId: freeProgramId, participant: { householdId: p.householdId } }});
                await prisma.householdLead.deleteMany({ where: { participant: { householdId: p.householdId } } });
                await prisma.participant.deleteMany({ where: { householdId: p.householdId } });
                await prisma.household.delete({ where: { id: p.householdId as number } });
            }
        });
    });
});
