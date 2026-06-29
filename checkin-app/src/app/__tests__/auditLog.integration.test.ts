/**
 * Integration Test for Audit Logs
 * Ensures that various actions across the system correctly generate an AuditLog.
 * Using Next.js testing practices with local Prisma DB.
 */

import { POST as createProgram } from '@/app/api/programs/route';
import { PATCH as updateProgramSettings } from '@/app/api/programs/[id]/settings/route';
import { POST as enrollParticipant } from '@/app/api/programs/[id]/participants/route';
import { POST as markAttendance } from '@/app/api/events/[id]/attendance/route';
import { PUT as editParticipant } from '@/app/api/membership-ops/participants/[id]/route';
import { POST as reassignHousehold } from '@/app/api/membership-ops/participants/[id]/household/route';
import { PATCH as updateRoles } from '@/app/api/roles/route';
import { POST as mergeParticipants } from '@/app/api/membership-ops/participants/merge/route';
import { PATCH as updateHousehold } from '@/app/api/membership-ops/households/[id]/route';
import { PATCH as updateVisit } from '@/app/api/facility/visits/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
// Mock Notifications to avoid external calls
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('AuditLog Integration Tests', () => {
    let testAdminId: number;
    let testParticipantId: number;
    let testProgramId: number;
    let testEventId: number;
    let testVisitId: number;

    // TAG-scoped throwaway entities for the admin-writer cases below, tracked by
    // id so afterAll cleans exactly what these tests made (no unfiltered deleteMany).
    const TAG = 'audit-writers';
    const createdParticipantIds: number[] = [];
    const createdHouseholdIds: number[] = [];
    const createdVisitIds: number[] = [];

    async function makeParticipant(suffix: string) {
        const p = await prisma.participant.create({
            // 'audit-test' substring also matches the beforeAll backstop sweep.
            data: { email: `${TAG}-${suffix}-audit-test@example.com`, name: `${TAG} ${suffix}`, household: { create: {} } },
            select: { id: true, householdId: true },
        });
        createdParticipantIds.push(p.id);
        if (p.householdId) createdHouseholdIds.push(p.householdId);
        return p;
    }

    beforeAll(async () => {
        // Clean up any leaked state from previous runs
        await prisma.auditLog.deleteMany({});
        await prisma.visit.deleteMany({});
        await prisma.rSVP.deleteMany({});
        await prisma.programParticipant.deleteMany({});
        await prisma.programVolunteer.deleteMany({});
        await prisma.event.deleteMany({});
        await prisma.program.deleteMany({});
        await prisma.participant.deleteMany({
            where: { email: { contains: 'audit-test' } }
        });

        // Setup mock database records
        const admin = await prisma.participant.create({
            data: { email: 'admin-audit-test@example.com', name: 'Admin Test', sysadmin: true, household: { create: {} } }
        });
        testAdminId = admin.id;

        const participant = await prisma.participant.create({
            data: { email: 'participant-audit-test@example.com', name: 'Participant Test', household: { create: {} } }
        });
        testParticipantId = participant.id;
    });

    afterAll(async () => {
        // TAG-scoped cleanup for the admin-writer cases (FK-safe order). Audit rows
        // they wrote all carry actorId=testAdminId and are swept by the block below.
        if (createdVisitIds.length > 0) {
            await prisma.visit.deleteMany({ where: { id: { in: createdVisitIds } } });
        }
        if (createdParticipantIds.length > 0) {
            await prisma.householdLead.deleteMany({ where: { participantId: { in: createdParticipantIds } } });
            await prisma.participant.deleteMany({ where: { id: { in: createdParticipantIds } } });
        }
        if (createdHouseholdIds.length > 0) {
            await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
        }

        // Clean up
        if (testParticipantId !== undefined) {
            await prisma.visit.deleteMany({ where: { participantId: testParticipantId } });
            await prisma.rSVP.deleteMany({ where: { participantId: testParticipantId } });
        }

        if (testProgramId !== undefined) {
            await prisma.event.deleteMany({ where: { programId: testProgramId } });
            await prisma.programParticipant.deleteMany({ where: { programId: testProgramId } });
            await prisma.program.deleteMany({ where: { id: testProgramId } });
        }

        const actorIds = [testAdminId, testParticipantId].filter(id => id !== undefined);
        if (actorIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: actorIds } }
            });

            // RESTRICT: delete participants before their households.
            const householdIds = (await prisma.participant.findMany({
                where: { id: { in: actorIds } },
                select: { householdId: true }
            })).map(p => p.householdId);

            await prisma.participant.deleteMany({
                where: { id: { in: actorIds } }
            });
            await prisma.household.deleteMany({
                where: { id: { in: householdIds } }
            });
        }
    });

    beforeEach(() => {
        // Reset mocks and default to admin session
        (getServerSession as jest.Mock).mockResolvedValue({
            user: { id: testAdminId, sysadmin: true }
        });
    });

    it('should generate an AuditLog when a Program is created', async () => {
        const req = new Request('http://localhost:4000/api/programs', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Audit Test Program',
                enrollmentStatus: 'OPEN',
                begin: new Date(),
                leadMentorId: testAdminId
            })
        });

        const res = await createProgram(req);
        expect(res.status).toBe(200);

        const responseData = await res.json();
        testProgramId = responseData.program.id;

        // Verify Audit Log
        const log = await prisma.auditLog.findFirst({
            where: {
                actorId: testAdminId,
                action: 'CREATE',
                tableName: 'Program',
                affectedEntityId: testProgramId
            },
            orderBy: { timestamp: 'desc' }
        });

        expect(log).toBeDefined();
        expect(log?.newData).toBeDefined();
    });

    it('should generate an AuditLog when Program Settings are updated', async () => {
        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/settings`, {
            method: 'PATCH',
            body: JSON.stringify({ leadMentorNotificationSettings: { notifyRsvp: true } })
        });

        const res = await updateProgramSettings(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        expect(res.status).toBe(200);

        // Verify Audit Log
        const log = await prisma.auditLog.findFirst({
            where: {
                actorId: testAdminId,
                action: 'EDIT',
                tableName: 'Program',
                affectedEntityId: testProgramId
            },
            orderBy: { timestamp: 'desc' }
        });

        expect(log).toBeDefined();
        const newData = log?.newData as { leadMentorNotificationSettings: { notifyRsvp: boolean } };
        expect(newData.leadMentorNotificationSettings.notifyRsvp).toBe(true);
    });

    it('should generate an AuditLog when an Admin enrolls a participant', async () => {
        const req = new Request(`http://localhost:4000/api/programs/${testProgramId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ participantId: testParticipantId, override: true })
        });

        const res = await enrollParticipant(req, { params: Promise.resolve({ id: testProgramId.toString() }) });
        const data = await res.json();
        if (res.status !== 200) console.error("Enrollment error:", data);
        expect(res.status).toBe(200);

        // Verify Audit Log
        const log = await prisma.auditLog.findFirst({
            where: {
                actorId: testAdminId,
                action: 'CREATE',
                tableName: 'ProgramParticipant',
                affectedEntityId: testParticipantId,
                secondaryAffectedEntity: testProgramId
            },
            orderBy: { timestamp: 'desc' }
        });

        expect(log).toBeDefined();
    });

    it('should generate an AuditLog when attendance is validated', async () => {
        // First create an event and visit manually to test validation
        const event = await prisma.event.create({
            data: { programId: testProgramId, name: 'Audit Test Event', start: new Date(), end: new Date() }
        });
        testEventId = event.id;

        const visit = await prisma.visit.create({
            data: { participantId: testParticipantId, arrived: new Date(Date.now() - 100000), departed: new Date(Date.now() + 100000) }
        });
        testVisitId = visit.id;

        const req = new Request(`http://localhost:4000/api/events/${testEventId}/attendance`, {
            method: 'POST',
            body: JSON.stringify({ participantIds: [testParticipantId] })
        });

        const res = await markAttendance(req, { params: Promise.resolve({ id: testEventId.toString() }) });
        expect(res.status).toBe(200);

        // Verify Audit Log: one row per validated Visit, keyed by the Visit PK
        // with the event as secondary (see attendance route, commit #467).
        const log = await prisma.auditLog.findFirst({
            where: {
                actorId: testAdminId,
                action: 'EDIT',
                tableName: 'Visit',
                affectedEntityId: testVisitId,
                secondaryAffectedEntity: testEventId
            },
            orderBy: { timestamp: 'desc' }
        });

        expect(log).toBeDefined();
        // Prisma Json fields can be returned as string depending on setup, the API explicitly stringified it
        const newDataString = log?.newData as string;
        const newData = JSON.parse(newDataString);
        expect(newData.participantId).toBe(testParticipantId);
        expect(newData.associatedEventId).toBe(testEventId);
    });

    it('should generate an AuditLog when an Admin edits participant PII', async () => {
        await prisma.auditLog.deleteMany({ where: { tableName: 'Participant' } });

        const req = new Request(`http://localhost:4000/api/membership-ops/participants/${testParticipantId}`, {
            method: 'PUT',
            body: JSON.stringify({ name: 'Edited Audit Name', email: 'edited-audit-test@example.com' })
        });

        const res = await editParticipant(req as never, { params: Promise.resolve({ id: testParticipantId.toString() }) });
        expect(res.status).toBe(200);

        const logs = await prisma.auditLog.findMany({
            where: { tableName: 'Participant', affectedEntityId: testParticipantId }
        });
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('EDIT');
        expect(logs[0].actorId).toBe(testAdminId);
        const newData = logs[0].newData as { name: string };
        expect(newData.name).toBe('Edited Audit Name');
    });

    it('should generate an AuditLog when an Admin reassigns a participant household', async () => {
        await prisma.auditLog.deleteMany({ where: { tableName: 'Participant' } });

        const newHousehold = await prisma.household.create({ data: { name: 'Audit Target Household' } });

        const req = new Request(`http://localhost:4000/api/membership-ops/participants/${testParticipantId}/household`, {
            method: 'POST',
            body: JSON.stringify({ householdId: newHousehold.id })
        });

        const res = await reassignHousehold(req as never, { params: Promise.resolve({ id: testParticipantId.toString() }) });
        expect(res.status).toBe(200);

        const logs = await prisma.auditLog.findMany({
            where: { tableName: 'Participant', affectedEntityId: testParticipantId }
        });
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('EDIT');
        const newData = logs[0].newData as { householdId: number };
        expect(newData.householdId).toBe(newHousehold.id);
    });

    // --- Additional high-stakes privilege / write coverage ---
    // Each asserts the route persists EXACTLY ONE AuditLog row with the right
    // actor (acting session user), action, table, affected entity, and newData.
    // Scoped by affectedEntityId on fresh TAG entities so they don't collide with
    // the Participant-table cleanup the two cases above perform.

    it('role grant (PATCH /admin/roles) writes one AuditLog with the privilege change', async () => {
        const target = await makeParticipant('role-target');

        const req = new Request('http://localhost:4000/api/roles', {
            method: 'PATCH',
            body: JSON.stringify({ targetUserId: target.id, keyholder: true }),
        });

        const res = await updateRoles(req as never);
        expect(res.status).toBe(200);

        const logs = await prisma.auditLog.findMany({
            where: { action: 'EDIT', tableName: 'Participant', affectedEntityId: target.id },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0].actorId).toBe(testAdminId);
        expect((logs[0].newData as { keyholder?: boolean }).keyholder).toBe(true);
    });

    it('participant merge (POST /admin/participants/merge) writes one AuditLog tombstoning the merged id', async () => {
        const keep = await makeParticipant('merge-keep');
        const merge = await makeParticipant('merge-from');

        const req = new Request('http://localhost:4000/api/membership-ops/participants/merge', {
            method: 'POST',
            body: JSON.stringify({ keepId: keep.id, mergeId: merge.id }),
        });

        const res = await mergeParticipants(req as never);
        const data = await res.json();
        if (res.status !== 200) console.error('Merge error:', data);
        expect(res.status).toBe(200);

        const logs = await prisma.auditLog.findMany({
            where: {
                action: 'DELETE',
                tableName: 'Participant',
                affectedEntityId: keep.id,
                secondaryAffectedEntity: merge.id,
            },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0].actorId).toBe(testAdminId);
        expect((logs[0].newData as { keepId?: number }).keepId).toBe(keep.id);
        expect((logs[0].oldData as { id?: number }).id).toBe(merge.id);
    });

    it('household edit (PATCH /admin/households/[id]) writes one AuditLog with before/after', async () => {
        const household = await prisma.household.create({ data: { name: `${TAG} household orig` }, select: { id: true } });
        createdHouseholdIds.push(household.id);

        const req = new Request(`http://localhost:4000/api/membership-ops/households/${household.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ name: 'Audit Edited Household' }),
        });

        const res = await updateHousehold(req as never, { params: Promise.resolve({ id: household.id.toString() }) });
        expect(res.status).toBe(200);

        const logs = await prisma.auditLog.findMany({
            where: { action: 'EDIT', tableName: 'Household', affectedEntityId: household.id },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0].actorId).toBe(testAdminId);
        // Route stringifies oldData/newData.
        expect(JSON.parse(logs[0].newData as string).name).toBe('Audit Edited Household');
        expect(JSON.parse(logs[0].oldData as string).name).toBe(`${TAG} household orig`);
    });

    it('visit edit (PATCH /admin/visits) writes one AuditLog snapshotting the visit', async () => {
        const owner = await makeParticipant('visit-owner');
        const visit = await prisma.visit.create({
            data: { participantId: owner.id, arrived: new Date(), departed: new Date() },
            select: { id: true },
        });
        createdVisitIds.push(visit.id);

        const newArrived = new Date('2020-01-01T10:00:00.000Z');
        const req = new Request('http://localhost:4000/api/facility/visits', {
            method: 'PATCH',
            body: JSON.stringify({ visitId: visit.id, arrived: newArrived.toISOString() }),
        });

        const res = await updateVisit(req as never);
        expect(res.status).toBe(200);

        const logs = await prisma.auditLog.findMany({
            where: { action: 'EDIT', tableName: 'Visit', affectedEntityId: visit.id },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0].actorId).toBe(testAdminId);
        expect((logs[0].newData as { id?: number }).id).toBe(visit.id);
    });
});
