/**
 * @jest-environment node
 */
/**
 * Integration Tests for Public Program Registration API (double opt-in).
 * Step 1: POST /api/programs/[id]/public-register        — validate + email a token, no writes.
 * Step 2: POST /api/programs/[id]/public-register/confirm — token → create everything.
 */

import { POST } from '@/app/api/programs/[id]/public-register/route';
import { POST as CONFIRM } from '@/app/api/programs/[id]/public-register/confirm/route';
import prisma from '@/lib/prisma';

// A signing secret is required for the confirmation token.
process.env.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-public-reg';

// Mock Notifications
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn().mockResolvedValue(true)
}));

// Mock the mailer so we can capture the confirmation token out of the email.
jest.mock('@/lib/email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));
import { sendEmail } from '@/lib/email';
const mockedSendEmail = sendEmail as jest.Mock;

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
        const existingUsers = await prisma.person.findMany({
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

        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create an existing user to test unique email constraints
        const existingUser = await prisma.person.create({
            data: { email: 'existing-user-test@example.com', name: 'Existing User', household: { create: {} } }
        });
        existingParticipantId = existingUser.id;

        // Create mock programs
        const standardProgram = await prisma.program.create({
            data: {
                name: 'Standard Public Reg Test',
                phase: 'RUNNING',
                enrollmentStatus: 'OPEN',
                orgMemberPriceCents: 1000,
                nonOrgMemberPriceCents: 1500,
                shopifyNonOrgMemberVariantId: '123456789'
            }
        });
        standardProgramId = standardProgram.id;

        const freeProgram = await prisma.program.create({
            data: { name: 'Free Public Reg Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', orgMemberPriceCents: null, nonOrgMemberPriceCents: null }
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
        const existingUsers = await prisma.person.findMany({
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

            await prisma.person.deleteMany({
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
            await prisma.person.deleteMany({
                where: { householdId: { in: householdIds } }
            });
            await prisma.household.deleteMany({
                where: { id: { in: householdIds } }
            });
        }
    });

    beforeEach(() => mockedSendEmail.mockClear());

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    // Each request gets a distinct client IP so the per-IP rate limiter (module
    // global) doesn't bleed across the many calls this suite makes.
    let ipSeq = 0;
    const makeReq = (id: number, body: unknown, suffix = '') =>
        new Request(`http://localhost:4000/api/programs/${id}/public-register${suffix}`, {
            method: 'POST',
            headers: { 'x-forwarded-for': `10.0.0.${++ipSeq}` },
            body: JSON.stringify(body),
        });

    // Run step 1 (request) and return the confirmation token captured from the email.
    const requestAndGetToken = async (id: number, body: unknown): Promise<string> => {
        const res = await POST(makeReq(id, body) as unknown as never, createParams(id) as unknown as never);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.pending).toBe(true);
        expect(data.checkoutUrl).toBeUndefined(); // no writes / no checkout at request time
        const html = mockedSendEmail.mock.calls.at(-1)?.[2] as string;
        const m = html.match(/token=([^"&]+)/);
        if (!m) throw new Error('no confirmation token found in email');
        return decodeURIComponent(m[1]);
    };

    // Run step 2 (confirm) for a token.
    const confirm = (id: number, token: string) =>
        CONFIRM(makeReq(id, { token }, '/confirm') as unknown as never, createParams(id) as unknown as never);

    describe('Step 1: POST /api/programs/[id]/public-register', () => {

        it('should block if primary parent is missing', async () => {
            const res = await POST(makeReq(standardProgramId, {
                parents: [],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                participants: [{ name: 'Timmy', dob: '2010-01-01' }]
            }) as unknown as never, createParams(standardProgramId) as unknown as never);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/Primary parent/i);
            expect(mockedSendEmail).not.toHaveBeenCalled();
        });

        it('should block if participant does not meet age constraints', async () => {
            const res = await POST(makeReq(exactAgeProgramId, {
                parents: [{ name: 'Mom', email: 'mom2@test.com', phone: '555-111-2222' }],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                participants: [{ name: 'Timmy', dob: '2015-01-01' }] // Under 18
            }) as unknown as never, createParams(exactAgeProgramId) as unknown as never);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/at least 18/i);
            expect(mockedSendEmail).not.toHaveBeenCalled();
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
            const p = await prisma.person.findUnique({ where: { email: inBoundsEmail } });
            if (p) {
                await prisma.programParticipant.deleteMany({ where: { person: { householdId: p.householdId } } });
                await prisma.householdLead.deleteMany({ where: { person: { householdId: p.householdId } } });
                await prisma.person.deleteMany({ where: { householdId: p.householdId } });
                await prisma.household.delete({ where: { id: p.householdId as number } });
            }
        });

        it('returns the same neutral response whether or not the email exists (no enumeration)', async () => {
            const known = await POST(makeReq(standardProgramId, {
                parents: [{ name: 'Dad', email: 'existing-user-test@example.com', phone: '555-111-2222' }],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                participants: [{ name: 'Timmy', dob: '2010-01-01' }]
            }) as unknown as never, createParams(standardProgramId) as unknown as never);
            const unknownEmail = await POST(makeReq(standardProgramId, {
                parents: [{ name: 'Dad', email: 'brand-new-nobody@example.com', phone: '555-111-2222' }],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                participants: [{ name: 'Timmy', dob: '2010-01-01' }]
            }) as unknown as never, createParams(standardProgramId) as unknown as never);
            expect(known.status).toBe(unknownEmail.status);
            expect(await known.json()).toEqual(await unknownEmail.json());
        });
    });

    describe('Step 2: POST /api/programs/[id]/public-register/confirm', () => {

        it('rejects an invalid / garbage token', async () => {
            const res = await confirm(standardProgramId, 'not-a-real-token');
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/invalid or has expired/i);
        });

        it('should block if parent email already exists', async () => {
            const token = await requestAndGetToken(standardProgramId, {
                parents: [{ name: 'Dad', email: 'existing-user-test@example.com', phone: '555-111-2222' }],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                participants: [{ name: 'Timmy', dob: '2010-01-01' }]
            });
            const res = await confirm(standardProgramId, token);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/already exists/i);
        });

        it('should block if emergency phone matches parent phone', async () => {
            const token = await requestAndGetToken(standardProgramId, {
                parents: [{ name: 'Dad', email: 'dad@test.com', phone: '(555) 123-4567' }],
                emergencyContact: { name: 'Aunt Sue', phone: '5551234567' }, // Same digits
                participants: [{ name: 'Timmy', dob: '2010-01-01' }]
            });
            const res = await confirm(standardProgramId, token);
            expect(res.status).toBe(400);
            // The not-a-household-member rule blocks this (matched on phone).
            expect((await res.json()).error).toMatch(/can't be its emergency contact|outside the household/i);
        });

        it('should block if program is full', async () => {
            const token = await requestAndGetToken(fullProgramId, {
                parents: [{ name: 'Mom', email: 'mom1@test.com', phone: '555-111-2222' }],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                participants: [{ name: 'Timmy', dob: '2010-01-01' }]
            });
            const res = await confirm(fullProgramId, token);
            expect(res.status).toBe(400);
            expect((await res.json()).error).toMatch(/open spots/i);
        });

        it('should successfully register a family with PENDING status and return Shopify URL', async () => {
            const token = await requestAndGetToken(standardProgramId, {
                parents: [{ name: 'Test Primary Parent', email: 'test-primary-parent@example.com', phone: '555-123-4444' }],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-8888' },
                participants: [
                    { name: 'Test Primary Parent' }, // implicitly matches parent by name
                    { name: 'Timmy Test', dob: '2010-05-05' }
                ]
            });
            const res = await confirm(standardProgramId, token);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.checkoutUrl).toContain('123456789:2'); // Variant ID : quantity
            expect(data.checkoutUrl).toContain('CheckMeIn_Account_ID');
            expect(data.isFree).toBe(false);

            // Verify db
            const parent = await prisma.person.findUnique({
                where: { email: 'test-primary-parent@example.com' },
                include: { householdLeads: true }
            });
            expect(parent).not.toBeNull();
            expect(parent?.householdLeads.length).toBe(1);

            const householdMembers = await prisma.person.findMany({
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
                // Capacity + the all-or-nothing rollback live in the confirm step now.
                const token = await requestAndGetToken(overflowProgram.id, {
                    parents: [{ name: 'Overflow Parent', email: overflowEmail, phone: '555-300-1111' }],
                    emergencyContact: { name: 'Aunt Sue', phone: '555-300-2222' },
                    // 3 children into a 2-seat program: 0 enrolled + 3 > 2.
                    participants: [
                        { name: 'Kid A', dob: '2012-01-01' },
                        { name: 'Kid B', dob: '2013-01-01' },
                        { name: 'Kid C', dob: '2014-01-01' },
                    ]
                });
                const res = await confirm(overflowProgram.id, token);
                expect(res.status).toBe(400);
                const data = await res.json();
                expect(data.error).toMatch(/open spots/i);

                // No enrollments created on the program.
                const enrollments = await prisma.programParticipant.count({ where: { programId: overflowProgram.id } });
                expect(enrollments).toBe(0);

                // No orphan parent/child Participant rows (whole tx rolled back).
                const parent = await prisma.person.findUnique({ where: { email: overflowEmail } });
                expect(parent).toBeNull();

                // No orphan Household row left behind.
                const householdsAfter = await prisma.household.count();
                expect(householdsAfter).toBe(householdsBefore);
            } finally {
                await prisma.program.delete({ where: { id: overflowProgram.id } });
            }
        });

        it('should set status to ACTIVE if the program is free', async () => {
            const uniqueEmail = `mom-free-${Date.now()}@test.com`;
            const token = await requestAndGetToken(freeProgramId, {
                parents: [{ name: 'Mom Free', email: uniqueEmail, phone: '555-111-3333' }],
                emergencyContact: { name: 'Aunt Sue', phone: '555-999-9999' },
                participants: [{ name: 'Timmy', dob: '2010-01-01' }]
            });
            const res = await confirm(freeProgramId, token);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.checkoutUrl).toBeNull();
            expect(data.isFree).toBe(true);

            // Clean up the created one immediately for isolation
            const p = await prisma.person.findUnique({ where: { email: uniqueEmail } });
            if (p) {
                await prisma.programParticipant.deleteMany({ where: { programId: freeProgramId, person: { householdId: p.householdId } }});
                await prisma.householdLead.deleteMany({ where: { person: { householdId: p.householdId } } });
                await prisma.person.deleteMany({ where: { householdId: p.householdId } });
                await prisma.household.delete({ where: { id: p.householdId as number } });
            }
        });
    });
});
