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
    let startBasisProgramId: number;
    let existingParticipantId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const testEmails = ['test-primary-parent@example.com', 'existing-user-test@example.com', 'max-age-boundary-parent@example.com', 'start-basis-parent@example.com'];
        const existingUsers = await prisma.participant.findMany({
            where: { email: { in: testEmails } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        
        await prisma.programParticipant.deleteMany({
            where: { personId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Public Reg Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });

        await prisma.householdLead.deleteMany({
            where: { personId: { in: existingUserIds } }
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
                    create: { personId: existingParticipantId } // Pre-fill
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

        // Free, minAge 18, starts 2026-09-01. Used to prove the age gate judges
        // age as of the program START date, not registration time.
        const startBasisProgram = await prisma.program.create({
            data: { name: 'Start Basis Public Reg Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', minAge: 18, startAt: new Date('2026-09-01T00:00:00.000Z') }
        });
        startBasisProgramId = startBasisProgram.id;
    });

    afterAll(async () => {
        const testEmails = ['test-primary-parent@example.com', 'existing-user-test@example.com', 'max-age-boundary-parent@example.com', 'start-basis-parent@example.com'];
        const existingUsers = await prisma.participant.findMany({
            where: { email: { in: testEmails } },
            select: { id: true, householdId: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const householdIds = existingUsers.map(u => u.householdId).filter(id => id !== null) as number[];

        const validProgramIds = [standardProgramId, freeProgramId, fullProgramId, exactAgeProgramId, maxAgeBoundaryProgramId, startBasisProgramId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: { personId: { in: existingUserIds } }
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
                where: { personId: { in: existingUserIds } }
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
                where: { person: { householdId: { in: householdIds } } }
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
        const FAKE_TIMER_OPTS: Parameters<typeof jest.useFakeTimers>[0] = {
            doNotFake: [
                'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
                'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask',
                'requestAnimationFrame', 'cancelAnimationFrame', 'hrtime', 'performance',
            ],
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

        it('should judge age as of the program START date, not registration time', async () => {
            // startBasisProgram: minAge 18, begins 2026-09-01. Clock frozen at
            // 2026-01-01, applicant born 2008-06-15 => age 17 NOW but 18 by the
            // start date. Registration-time math would reject; start-date math admits.
            jest.useFakeTimers(FAKE_TIMER_OPTS);
            try {
                const req = new Request(`http://localhost:4000/api/programs/${startBasisProgramId}/public-register`, {
                    method: 'POST',
                    headers: { 'x-forwarded-for': '203.0.113.12' },
                    body: JSON.stringify({
                        parents: [{ name: 'Boundary Parent', email: 'start-basis-parent@example.com', phone: '555-123-9999' }],
                        emergencyContact: { name: 'Aunt Sue', phone: '555-999-9988' },
                        participants: [{ name: 'Turns Eighteen', dob: '2008-06-15T12:00:00.000Z' }]
                    })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, createParams(startBasisProgramId) as unknown as never);
                expect(res.status).toBe(200);
                const data = await res.json();
                expect(data.success).toBe(true);
            } finally {
                jest.useRealTimers();
            }
        });

        // GAP 3: the under-min case is covered above; these add the missing
        // over-MAX rejection and an in-bounds success, so both ends of the
        // public-register age gate (independent of the authenticated route) are
        // exercised. exactAgeProgram is minAge 18 / maxAge 21, startAt null -> age
        // judged as of now, frozen here for determinism.
        it('should reject a participant over the maximum age', async () => {
            jest.useFakeTimers(FAKE_TIMER_OPTS);
            try {
                const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/public-register`, {
                    method: 'POST',
                    headers: { 'x-forwarded-for': '203.0.113.20' },
                    body: JSON.stringify({
                        parents: [{ name: 'Over Max Parent', email: 'over-max-parent@example.com', phone: '555-200-1111' }],
                        emergencyContact: { name: 'Aunt Sue', phone: '555-200-2222' },
                        participants: [{ name: 'Old Kid', dob: '2000-06-01T12:00:00.000Z' }] // 25 now, max is 21
                    })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
                expect(res.status).toBe(400);
                const data = await res.json();
                expect(data.error).toMatch(/maximum age is 21/i);
            } finally {
                jest.useRealTimers();
            }
        });

        it('should register a participant whose age is within the min/max bounds', async () => {
            jest.useFakeTimers(FAKE_TIMER_OPTS);
            const inBoundsEmail = 'in-bounds-age-parent@example.com';
            try {
                const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/public-register`, {
                    method: 'POST',
                    headers: { 'x-forwarded-for': '203.0.113.21' },
                    body: JSON.stringify({
                        parents: [{ name: 'In Bounds Parent', email: inBoundsEmail, phone: '555-210-1111' }],
                        emergencyContact: { name: 'Aunt Sue', phone: '555-210-2222' },
                        participants: [{ name: 'Right Age Kid', dob: '2006-06-01T12:00:00.000Z' }] // 19 now, in [18,21]
                    })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
                expect(res.status).toBe(200);
                const data = await res.json();
                expect(data.success).toBe(true);
            } finally {
                jest.useRealTimers();
            }

            // Inline cleanup: this parent email isn't in the afterAll sweep list.
            const p = await prisma.participant.findUnique({ where: { email: inBoundsEmail } });
            if (p) {
                await prisma.programParticipant.deleteMany({ where: { person: { householdId: p.householdId } } });
                await prisma.householdLead.deleteMany({ where: { person: { householdId: p.householdId } } });
                await prisma.participant.deleteMany({ where: { householdId: p.householdId } });
                await prisma.household.delete({ where: { id: p.householdId as number } });
            }
        });

        it('should successfully register a family with correct PENDING status and return Shopify URL', async () => {
            const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/public-register`, {
                method: 'POST',
                headers: { 'x-forwarded-for': '203.0.113.1' }, // own rate-limit bucket so earlier block tests don't 429 this
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
                where: { programId: standardProgramId, person: { householdId: parent?.householdId } }
            });
            expect(enrollments.length).toBe(2);
            expect(enrollments[0].status).toBe('PENDING');
        });

        // Atomicity: a single registration whose participant count exceeds the
        // remaining seats must be rejected as a whole, leaving ZERO partial
        // state. This is the only path that passes seats>1 to
        // lockProgramAndCheckCapacity, so it's the only one exercising the
        // all-or-nothing rollback on overflow.
        it('should leave no partial state when one registration overflows capacity', async () => {
            const overflowProgram = await prisma.program.create({
                data: { name: 'Overflow Public Reg Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', maxParticipants: 2 }
            });
            const overflowEmail = `overflow-parent-${Date.now()}@test.com`;
            const householdsBefore = await prisma.household.count();
            try {
                const req = new Request(`http://localhost:4000/api/programs/${overflowProgram.id}/public-register`, {
                    method: 'POST',
                    headers: { 'x-forwarded-for': '203.0.113.30' }, // own rate-limit bucket
                    body: JSON.stringify({
                        parents: [{ name: 'Overflow Parent', email: overflowEmail, phone: '555-300-1111' }],
                        emergencyContact: { name: 'Aunt Sue', phone: '555-300-2222' },
                        // 3 children into a 2-seat program: 0 enrolled + 3 > 2.
                        participants: [
                            { name: 'Kid A', dob: '2012-01-01' },
                            { name: 'Kid B', dob: '2013-01-01' },
                            { name: 'Kid C', dob: '2014-01-01' },
                        ]
                    })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, createParams(overflowProgram.id) as unknown as never);
                expect(res.status).toBe(400);
                const data = await res.json();
                expect(data.error).toMatch(/open spots/i);

                // No enrollments created on the program.
                const enrollments = await prisma.programParticipant.count({ where: { programId: overflowProgram.id } });
                expect(enrollments).toBe(0);

                // No orphan parent/child Participant rows (whole tx rolled back).
                const parent = await prisma.participant.findUnique({ where: { email: overflowEmail } });
                expect(parent).toBeNull();

                // No orphan Household row left behind.
                const householdsAfter = await prisma.household.count();
                expect(householdsAfter).toBe(householdsBefore);
            } finally {
                await prisma.program.delete({ where: { id: overflowProgram.id } });
            }
        });

        it('should set status to ACTIVE if the program is free', async () => {
            // Need a new unique parent because the first one is already generated
            const uniqueEmail = `mom-free-${Date.now()}@test.com`;
            const req = new Request(`http://localhost:4000/api/programs/${freeProgramId}/public-register`, {
                method: 'POST',
                headers: { 'x-forwarded-for': '203.0.113.2' }, // own rate-limit bucket so earlier block tests don't 429 this
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
                await prisma.programParticipant.deleteMany({ where: { programId: freeProgramId, person: { householdId: p.householdId } }});
                await prisma.householdLead.deleteMany({ where: { person: { householdId: p.householdId } } });
                await prisma.participant.deleteMany({ where: { householdId: p.householdId } });
                await prisma.household.delete({ where: { id: p.householdId as number } });
            }
        });
    });
});
