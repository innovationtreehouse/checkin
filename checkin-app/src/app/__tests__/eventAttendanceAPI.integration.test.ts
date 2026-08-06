/**
 * @jest-environment node
 */
/**
 * Integration Tests for Event Attendance API
 * Tests POST /api/events/[id]/attendance for validating participant attendance
 */

import { POST } from '@/app/api/events/[id]/attendance/route';
import { normalizeAuditData } from '@/lib/auditPayload';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
describe('Event Attendance API Integration Tests', () => {
    let testAdminId: number;
    let testUserId: number;
    let testLeadMentorId: number;
    let testProgramId: number;
    let testEventId: number;
    let testParticipant1Id: number;
    let testParticipant2Id: number;
    // Cross-tenant attacker: lead of a DIFFERENT program (IDOR boundary).
    let foreignLeadId: number;
    let foreignProgramId: number;
    // Keyholder who is neither board nor sysadmin, plus a standalone
    // (program-less) event — the unfenced-target boundary.
    let keyholderId: number;
    let standaloneEventId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        await prisma.visit.deleteMany({
            where: { person: { email: { contains: 'event-attendance-test' } } }
        });
        await prisma.event.deleteMany({
            where: { name: { in: ['Attendance Test Event', 'Attendance Test Standalone Event'] } }
        });
        await prisma.program.deleteMany({
            where: { name: 'Attendance Test Program' }
        });
        await prisma.person.deleteMany({
            where: { email: { contains: 'event-attendance-test' } }
        });

        // Setup mock database records
        const admin = await prisma.person.create({
            data: { email: 'admin-event-attendance-test@example.com', name: 'Admin Att Test', isSysadmin: true, household: { create: { name: "Test HH" } } }
        });
        testAdminId = admin.id;

        const user = await prisma.person.create({
            data: { email: 'user-event-attendance-test@example.com', name: 'User Att Test', household: { create: { name: "Test HH" } } }
        });
        testUserId = user.id;

        const mentor = await prisma.person.create({
            data: { email: 'mentor-event-attendance-test@example.com', name: 'Mentor Att Test', household: { create: { name: "Test HH" } } }
        });
        testLeadMentorId = mentor.id;

        const participant1 = await prisma.person.create({
            data: { email: 'p1-event-attendance-test@example.com', name: 'P1 Att Test', household: { create: { name: "Test HH" } } }
        });
        testParticipant1Id = participant1.id;

        const participant2 = await prisma.person.create({
            data: { email: 'p2-event-attendance-test@example.com', name: 'P2 Att Test', household: { create: { name: "Test HH" } } }
        });
        testParticipant2Id = participant2.id;

        const program = await prisma.program.create({
            data: {
                name: 'Attendance Test Program',
                leadMentorId: testLeadMentorId,
                maxParticipants: 10,
                minAge: 5,
                maxAge: 18,
            }
        });
        testProgramId = program.id;

        // A lead of an UNRELATED program — the cross-tenant attacker for the IDOR
        // tests. Privileged in their own program, but not lead/staff of testEvent's.
        const foreignLead = await prisma.person.create({
            data: { email: 'foreignlead-event-attendance-test@example.com', name: 'Foreign Lead Att Test', household: { create: { name: "Test HH" } } }
        });
        foreignLeadId = foreignLead.id;
        const foreignProgram = await prisma.program.create({
            data: { name: 'Attendance Test Foreign Program', leadMentorId: foreignLeadId, maxParticipants: 10, minAge: 5, maxAge: 18 }
        });
        foreignProgramId = foreignProgram.id;

        const keyholder = await prisma.person.create({
            data: { email: 'keyholder-event-attendance-test@example.com', name: 'Keyholder Att Test', isKeyholder: true, household: { create: { name: "Test HH" } } }
        });
        keyholderId = keyholder.id;

        const now = new Date();
        const pastStart = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago
        const pastEnd = new Date(now.getTime() - 1 * 60 * 60 * 1000); // 1 hour ago

        const event = await prisma.event.create({
            data: {
                name: 'Attendance Test Event',
                programId: testProgramId,
                startAt: pastStart,
                endAt: pastEnd
            }
        });
        testEventId = event.id;

        const standaloneEvent = await prisma.event.create({
            data: {
                name: 'Attendance Test Standalone Event',
                programId: null,
                startAt: pastStart,
                endAt: pastEnd
            }
        });
        standaloneEventId = standaloneEvent.id;

        // Attendance can only be written for participants enrolled (or volunteering)
        // in the event's program — enroll the two targets so the happy-path writes
        // are authorized. testUserId is deliberately left unenrolled (IDOR target).
        await prisma.programParticipant.createMany({
            data: [
                { programId: testProgramId, personId: testParticipant1Id },
                { programId: testProgramId, personId: testParticipant2Id },
            ]
        });
    });

    afterAll(async () => {
        // Clean up
        await prisma.visit.deleteMany({
            where: { personId: { in: [testParticipant1Id, testParticipant2Id, testUserId] } }
        });
        await prisma.event.deleteMany({
            where: { id: { in: [testEventId, standaloneEventId] } }
        });
        // FK: enrollments reference the program — clear before deleting it.
        await prisma.programParticipant.deleteMany({
            where: { programId: { in: [testProgramId, foreignProgramId] } }
        });
        await prisma.program.deleteMany({
            where: { id: { in: [testProgramId, foreignProgramId] } }
        });
        const participantIds = [testAdminId, testUserId, testLeadMentorId, testParticipant1Id, testParticipant2Id, foreignLeadId, keyholderId];

        // RESTRICT: delete participants before their (auto-created) households.
        const householdIds = (await prisma.person.findMany({
            where: { id: { in: participantIds } },
            select: { householdId: true }
        })).map(p => p.householdId);

        await prisma.person.deleteMany({
            where: { id: { in: participantIds } }
        });
        await prisma.household.deleteMany({
            where: { id: { in: householdIds } }
        });
    });

    afterEach(async () => {
        // Clear visits created during tests
        await prisma.visit.deleteMany({
            where: { personId: { in: [testParticipant1Id, testParticipant2Id, testUserId] } }
        });
        // Clear audit rows so each test asserts exactly its own write. A Visit
        // audit row carries the SUBJECT in secondaryAffectedEntity, so scope by
        // this suite's participants — fresh ids per run, so still leak-proof.
        await prisma.auditLog.deleteMany({
            where: { tableName: 'Visit', secondaryAffectedEntity: { in: [testParticipant1Id, testParticipant2Id, testUserId] } }
        });
    });

    describe('POST /api/events/[id]/attendance', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ participantIds: [testParticipant1Id] })
             });

             const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });
             expect(res.status).toBe(401);
        });

        it('should return 403 Forbidden for non-admin/non-lead-mentor users', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({
                 user: { id: testUserId, isSysadmin: false, isBoardMember: false, isKeyholder: false }
             });

             const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                 method: 'POST',
                 body: JSON.stringify({ participantIds: [testParticipant1Id] })
             });

             const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });
             expect(res.status).toBe(403);
        });

        // IDOR boundary: the gate is the inline `event.program.leadMentorId === caller`
        // check (route.ts). A caller who is NOT this event's lead/admin must be 403'd
        // AND must not write a Visit/audit row. A 403 alone doesn't prove that — a
        // guard that ran AFTER the write would still 403. Re-query to pin it.
        // Mirrors fd192fc (trusted-adults "assert no mutation after IDOR 403").
        async function attendanceWriteCount() {
            const visits = await prisma.visit.count({
                where: { personId: { in: [testParticipant1Id, testParticipant2Id] }, associatedEventId: testEventId }
            });
            const audits = await prisma.auditLog.count({
                where: { tableName: 'Visit', secondaryAffectedEntity: { in: [testParticipant1Id, testParticipant2Id] } }
            });
            return { visits, audits };
        }

        it('IDOR: a lead of a DIFFERENT program cannot mark attendance (403, no Visit written)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: foreignLeadId, isSysadmin: false, isBoardMember: false, isKeyholder: false }
            });
            const before = await attendanceWriteCount();

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant1Id, testParticipant2Id] })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });

            expect(res.status).toBe(403);
            expect(await attendanceWriteCount()).toEqual(before);
        });

        it('IDOR: a plain member of no program cannot mark attendance (403, no Visit written)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testUserId, isSysadmin: false, isBoardMember: false, isKeyholder: false }
            });
            const before = await attendanceWriteCount();

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant1Id, testParticipant2Id] })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });

            expect(res.status).toBe(403);
            expect(await attendanceWriteCount()).toEqual(before);
        });

        it('should return 404 Not Found for invalid event ID', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true, isBoardMember: false, isKeyholder: false }
            });

            const req = new Request(`http://localhost:4000/api/events/9999999/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant1Id] })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: '9999999' }) });
            expect(res.status).toBe(404);
        });

        it('should create a synthetic visit for a participant with no existing visit', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testLeadMentorId, isSysadmin: false, isBoardMember: false, isKeyholder: false }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant1Id] })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.processed).toBe(1);

            const visits = await prisma.visit.findMany({
                where: { personId: testParticipant1Id, associatedEventId: testEventId }
            });
            expect(visits.length).toBe(1);
            expect(visits[0].arrivedAt).not.toBeNull();
            expect(visits[0].departedAt).not.toBeNull();

            // Audit: exactly one row keyed by the new Visit's PK, the SUBJECT in
            // secondaryAffectedEntity, crediting the acting lead mentor — so
            // actorId !== secondaryAffectedEntity marks it as acting-for-another.
            const auditRows = await prisma.auditLog.findMany({
                where: { tableName: 'Visit', secondaryAffectedEntity: { in: [testParticipant1Id, testParticipant2Id] } }
            });
            expect(auditRows.length).toBe(1);
            expect(auditRows[0].actorId).toBe(testLeadMentorId);
            expect(auditRows[0].action).toBe('CREATE');
            expect(auditRows[0].affectedEntityId).toBe(visits[0].id);
            expect(normalizeAuditData(auditRows[0].newData)).toEqual({
                participantId: testParticipant1Id,
                associatedEventId: testEventId,
                synthetic: true
            });
        });

        it('should link an existing unassociated visit that overlaps with the event', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testAdminId, isSysadmin: true }
            });

            // Create a general visit that overlaps with the event
            const event = await prisma.event.findUnique({ where: { id: testEventId } });
            const earlyArrival = new Date(event!.startAt.getTime() - 30 * 60 * 1000); // Arrived 30 mins before event
            
            await prisma.visit.create({
                data: {
                    personId: testParticipant2Id,
                    arrivedAt: earlyArrival,
                    departedAt: null, // Still active
                }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant2Id] })
            });

            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.success).toBe(true);
            expect(data.processed).toBe(1);

            const visits = await prisma.visit.findMany({
                where: { personId: testParticipant2Id }
            });
            expect(visits.length).toBe(1); // Should only be the one we created
            expect(visits[0].associatedEventId).toBe(testEventId); // It was successfully linked
            expect(visits[0].arrivedAt.getTime()).toBe(earlyArrival.getTime()); // Validates it used the existing visit

            // Audit: exactly one row keyed by the linked Visit's PK, the SUBJECT
            // in secondaryAffectedEntity, crediting the acting admin.
            const auditRows = await prisma.auditLog.findMany({
                where: { tableName: 'Visit', secondaryAffectedEntity: { in: [testParticipant1Id, testParticipant2Id] } }
            });
            expect(auditRows.length).toBe(1);
            expect(auditRows[0].actorId).toBe(testAdminId);
            expect(auditRows[0].action).toBe('EDIT');
            expect(auditRows[0].affectedEntityId).toBe(visits[0].id);
            expect(normalizeAuditData(auditRows[0].newData)).toEqual({
                participantId: testParticipant2Id,
                associatedEventId: testEventId,
                synthetic: false
            });
        });

        it('IDOR: the event lead cannot fabricate attendance for a participant NOT enrolled in the program (400, no Visit written)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: testLeadMentorId, isSysadmin: false, isBoardMember: false, isKeyholder: false }
            });

            // testUserId is a real participant but enrolled in no program.
            const before = await prisma.visit.count({ where: { personId: testUserId, associatedEventId: testEventId } });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testUserId] })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });

            expect(res.status).toBe(400);
            const after = await prisma.visit.count({ where: { personId: testUserId, associatedEventId: testEventId } });
            expect(after).toBe(before);
        });

        // A program-less event has no enrollment set, so the target filter never
        // runs — the actor gate is the only authz on participantIds there. It must
        // therefore admit board/sysadmin alone, who may record a visit for anyone.
        describe('program-less (standalone) event', () => {
            async function standaloneWriteCount() {
                const visits = await prisma.visit.count({
                    where: { personId: testUserId }
                });
                const audits = await prisma.auditLog.count({
                    where: { tableName: 'Visit', secondaryAffectedEntity: testUserId }
                });
                return { visits, audits };
            }

            it('IDOR: a keyholder who is neither board nor sysadmin cannot mark attendance (403, no Visit written)', async () => {
                (getServerSession as jest.Mock).mockResolvedValue({
                    user: { id: keyholderId, isSysadmin: false, isBoardMember: false, isKeyholder: true }
                });
                const before = await standaloneWriteCount();

                // testUserId is enrolled in nothing and unrelated to this event.
                const req = new Request(`http://localhost:4000/api/events/${standaloneEventId}/attendance`, {
                    method: 'POST',
                    body: JSON.stringify({ participantIds: [testUserId] })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(standaloneEventId) }) });

                expect(res.status).toBe(403);
                expect(await standaloneWriteCount()).toEqual(before);
            });

            it('a board member can mark attendance for anyone', async () => {
                (getServerSession as jest.Mock).mockResolvedValue({
                    user: { id: testAdminId, isSysadmin: false, isBoardMember: true, isKeyholder: false }
                });

                const req = new Request(`http://localhost:4000/api/events/${standaloneEventId}/attendance`, {
                    method: 'POST',
                    body: JSON.stringify({ participantIds: [testUserId] })
                });
                const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(standaloneEventId) }) });

                expect(res.status).toBe(200);
                expect(await res.json()).toEqual({ success: true, processed: 1 });
                expect(await prisma.visit.count({
                    where: { personId: testUserId, associatedEventId: standaloneEventId }
                })).toBe(1);
            });
        });

        it('a keyholder can still mark an enrolled participant on a program event', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({
                user: { id: keyholderId, isSysadmin: false, isBoardMember: false, isKeyholder: true }
            });

            const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
                method: 'POST',
                body: JSON.stringify({ participantIds: [testParticipant1Id] })
            });
            const res = await POST(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(testEventId) }) });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ success: true, processed: 1 });
            expect(await prisma.visit.count({
                where: { personId: testParticipant1Id, associatedEventId: testEventId }
            })).toBe(1);
        });
    });
});
