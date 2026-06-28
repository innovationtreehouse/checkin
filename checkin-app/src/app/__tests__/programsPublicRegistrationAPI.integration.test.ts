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
    let maxAgeBoundaryProgramId: number;
    let existingParticipantId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const testEmails = ['test-primary-parent@example.com', 'existing-user-test@example.com', 'max-age-boundary-parent@example.com'];
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
            data: { email: 'existing-user-test@example.com', name: 'Existing User', household: { create: {} } }
        });
        existingParticipantId = existingUser.id;

        // Create mock programs
        const standardProgram = await prisma.program.create({
            data: { 
                name: 'Standard Public Reg Test', 
                phase: 'RUNNING', 
                enrollmentStatus: 'OPEN', 
                memberPriceCents: 1000, 
                nonMemberPriceCents: 1500,
                shopifyNonMemberVariantId: '123456789'
            }
        });
        standardProgramId = standardProgram.id;

        const freeProgram = await prisma.program.create({
            data: { name: 'Free Public Reg Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', memberPriceCents: null, nonMemberPriceCents: null }
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

        // Free (price-less => ACTIVE) program with a tight upper age bound, used
        // by the age-boundary regression tests below.
        const maxAgeBoundaryProgram = await prisma.program.create({
            data: { name: 'Max Age Boundary Public Reg Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', maxAge: 17 }
        });
        maxAgeBoundaryProgramId = maxAgeBoundaryProgram.id;
    });

    afterAll(async () => {
        const testEmails = ['test-primary-parent@example.com', 'existing-user-test@example.com', 'max-age-boundary-parent@example.com'];
        const existingUsers = await prisma.participant.findMany({
            where: { email: { in: testEmails } },
            select: { id: true, householdId: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const householdIds = existingUsers.map(u => u.householdId).filter(id => id !== null) as number[];

        const validProgramIds = [standardProgramId, freeProgramId, fullProgramId, exactAgeProgramId, maxAgeBoundaryProgramId].filter(id => id !== undefined);

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
            // Children registered into these households have no email, so the
            // lookup above misses them — remove all remaining members before
            // the household itself (the FK is RESTRICT).
            await prisma.householdLead.deleteMany({
                where: { householdId: { in: householdIds } }
            });
            await prisma.programParticipant.deleteMany({
                where: { participant: { householdId: { in: householdIds } } }
            });
            await prisma.participant.deleteMany({
                where: { householdId: { in: householdIds } }
            });
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
            // The not-a-household-member rule now blocks this (matched on phone) with a unified message.
            expect(data.error).toMatch(/can't be its emergency contact|outside the household/i);
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

        // Regression: the old inline epoch-delta age math
        // (`new Date(Date.now()-dob).getUTCFullYear()-1970`) ignores month/day and
        // counts someone whose birthday hasn't happened yet this year as ONE YEAR
        // TOO OLD. We freeze the clock so a participant who is calendar-age 17
        // (turns 18 *tomorrow*) is read as 18 by the buggy code. The leap-day
        // drift that triggers the off-by-one only surfaces in Jan/Feb, so the
        // frozen instant is required for these to be deterministic year-round.
        // Date faked only (timers left real) so Prisma's pg pool keeps working.
        const FAKE_TIMER_OPTS = {
            doNotFake: [
                'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
                'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
                'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime', 'performance',
            ] as const,
            now: new Date('2026-01-01T12:00:00.000Z'),
        };
        const BOUNDARY_DOB = '2008-01-02T12:00:00.000Z'; // calendar-age 17 at the frozen now; buggy math -> 18

        it('should NOT reject an at-maximum-age participant whose birthday is later this year', async () => {
            jest.useFakeTimers(FAKE_TIMER_OPTS);
            try {
                const req = new Request(`http://localhost:4000/api/programs/${maxAgeBoundaryProgramId}/public-register`, {
                    method: 'POST',
                    // Own IP bucket so the shared per-IP rate limit (other tests use the
                    // default "unknown" IP) can't pre-exhaust this request.
                    headers: { 'x-forwarded-for': '203.0.113.10' },
                    body: JSON.stringify({
                        parents: [{ name: 'Boundary Parent', email: 'max-age-boundary-parent@example.com', phone: '555-123-7777' }],
                        emergencyContact: { name: 'Aunt Sue', phone: '555-999-7788' },
                        participants: [{ name: 'Birthday Kid', dob: BOUNDARY_DOB }] // 17 now (max is 17); buggy math says 18
                    })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, createParams(maxAgeBoundaryProgramId) as unknown as never);
                // Buggy code rejected this with "maximum age is 17"; correct code admits the 17-year-old.
                expect(res.status).toBe(200);
                const data = await res.json();
                expect(data.success).toBe(true);
            } finally {
                jest.useRealTimers();
            }
        });

        it('should reject an under-minimum-age participant the buggy math counted as old enough', async () => {
            jest.useFakeTimers(FAKE_TIMER_OPTS);
            try {
                // exactAgeProgram has minAge 18; the participant is calendar-age 17.
                const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/public-register`, {
                    method: 'POST',
                    headers: { 'x-forwarded-for': '203.0.113.11' },
                    body: JSON.stringify({
                        parents: [{ name: 'Boundary Parent', email: 'min-age-boundary-parent@example.com', phone: '555-123-8888' }],
                        emergencyContact: { name: 'Aunt Sue', phone: '555-999-8877' },
                        participants: [{ name: 'Birthday Kid', dob: BOUNDARY_DOB }] // 17 now (min is 18); buggy math says 18
                    })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
                // Buggy code admitted this 17-year-old (counted as 18); correct code rejects.
                expect(res.status).toBe(400);
                const data = await res.json();
                expect(data.error).toMatch(/at least 18/i);
            } finally {
                jest.useRealTimers();
            }
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
