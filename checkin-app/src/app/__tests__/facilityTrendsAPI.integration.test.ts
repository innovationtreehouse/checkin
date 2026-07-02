/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/facility/trends.
 *
 * 401/403 (roles: isSysadmin, isBoardMember) are already covered by
 * authzRoleRejection.integration.test.ts — this file focuses on the success
 * path: bucketing visits by period, the volunteer/participant split (by program
 * enrollment — ProgramParticipant, NOT age), structured (event-associated) vs
 * unstructured hours, the `arrivedVia=SYSTEM` exclusion (synthetic "marked
 * present" visits), the `programId` filter, and the invalid-period 400.
 */

import { GET } from '@/app/api/facility/trends/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

const TAG = 'facility-trends-test';

describe('Facility trends API', () => {
    let adminId: number;
    let householdId: number;
    let volunteerId: number; // adult, not enrolled -> volunteer
    let enrolledAdultId: number; // adult, ACTIVE ProgramParticipant -> participant (proves age doesn't drive it)
    let youthId: number; // youth by DOB, not enrolled -> volunteer (proves age doesn't drive it)
    let programId: number;
    let otherProgramId: number;
    let eventId: number;
    const visitIds: number[] = [];

    const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

    beforeAll(async () => {
        const admin = await prisma.participant.create({
            data: { email: `admin-${TAG}@example.com`, name: 'Admin', isSysadmin: true, household: { create: {} } },
        });
        adminId = admin.id;
        householdId = admin.householdId;

        const volunteer = await prisma.participant.create({
            data: { email: `volunteer-${TAG}@example.com`, name: 'Volunteer', dateOfBirth: new Date('1980-01-01'), householdId },
        });
        volunteerId = volunteer.id;
        const enrolledAdult = await prisma.participant.create({
            data: { email: `enrolled-${TAG}@example.com`, name: 'Enrolled Adult', dateOfBirth: new Date('1985-01-01'), householdId },
        });
        enrolledAdultId = enrolledAdult.id;
        const youth = await prisma.participant.create({
            data: { email: `youth-${TAG}@example.com`, name: 'Youth', dateOfBirth: new Date('2015-01-01'), householdId },
        });
        youthId = youth.id;

        const program = await prisma.program.create({ data: { name: `Prog ${TAG}` } });
        programId = program.id;
        const otherProgram = await prisma.program.create({ data: { name: `Other ${TAG}` } });
        otherProgramId = otherProgram.id;
        const event = await prisma.event.create({
            data: { programId, name: `Event ${TAG}`, startAt: hoursAgo(5), endAt: hoursAgo(2) },
        });
        eventId = event.id;

        // Enroll the adult in `programId` (ACTIVE) — this, not their age, makes them a participant.
        await prisma.programParticipant.create({
            data: { programId, participantId: enrolledAdultId, status: 'ACTIVE' },
        });

        // Structured visit (associated to the event): enrolled adult, 3 hours -> participant.
        const structured = await prisma.visit.create({
            data: { personId: enrolledAdultId, arrivedAt: hoursAgo(5), departedAt: hoursAgo(2), arrivedVia: 'SCANNER', associatedEventId: eventId },
        });
        // Structured visit (associated to the event): non-enrolled youth, 2 hours -> volunteer.
        const youthStructured = await prisma.visit.create({
            data: { personId: youthId, arrivedAt: hoursAgo(5), departedAt: hoursAgo(3), arrivedVia: 'SCANNER', associatedEventId: eventId },
        });
        // Unstructured visit (no event): non-enrolled adult volunteer, 1 hour.
        const unstructured = await prisma.visit.create({
            data: { personId: volunteerId, arrivedAt: hoursAgo(4), departedAt: hoursAgo(3), arrivedVia: 'WEB' },
        });
        // Synthetic "marked present" visit (arrivedVia SYSTEM) — must be excluded entirely.
        const synthetic = await prisma.visit.create({
            data: { personId: volunteerId, arrivedAt: hoursAgo(5), departedAt: hoursAgo(2), arrivedVia: 'SYSTEM', associatedEventId: eventId },
        });
        // Still-open visit (no departedAt) — excluded (departedAt: { not: null } in the where).
        const open = await prisma.visit.create({
            data: { personId: youthId, arrivedAt: hoursAgo(1), arrivedVia: 'WEB' },
        });
        visitIds.push(structured.id, youthStructured.id, unstructured.id, synthetic.id, open.id);
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({ where: { id: { in: visitIds } } });
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.event.deleteMany({ where: { id: eventId } });
        await prisma.program.deleteMany({ where: { id: { in: [programId, otherProgramId] } } });
        await prisma.participant.deleteMany({ where: { id: { in: [adminId, volunteerId, enrolledAdultId, youthId] } } });
        await prisma.household.deleteMany({ where: { id: householdId } });
    });

    const callAs = async (user: object | null, query = '') => {
        (getServerSession as jest.Mock).mockResolvedValue(user === null ? null : { user });
        const req = new Request(`http://localhost:4000/api/facility/trends${query}`, { method: 'GET' });
        return GET(req as unknown as import('next/server').NextRequest);
    };

    it('rejects an invalid period with 400', async () => {
        const res = await callAs({ id: adminId, isSysadmin: true }, '?period=fortnight');
        expect(res.status).toBe(400);
    });

    it('buckets visits, splitting volunteer/participant and structured/unstructured hours', async () => {
        const res = await callAs({ id: adminId, isSysadmin: true }, '?period=month');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.period).toBe('month');
        expect(Array.isArray(data.buckets)).toBe(true);

        // Everything we seeded lands in the current month's bucket.
        const thisMonth = data.buckets[data.buckets.length - 1];
        expect(thisMonth.uniqueVolunteers).toBeGreaterThanOrEqual(1);
        expect(thisMonth.uniqueParticipants).toBeGreaterThanOrEqual(1);
        // Structured (event-associated) = the 3h enrolled-adult + 2h youth visits; unstructured =
        // the 1h volunteer visit. SYSTEM-sourced and still-open visits are excluded.
        expect(thisMonth.structuredHours).toBeGreaterThanOrEqual(5);
        expect(thisMonth.unstructuredHours).toBeGreaterThanOrEqual(1);
        expect(data.totals.label).toBe('Total');
    });

    it('splits by program enrollment, not age', async () => {
        // Scope to `programId` so only this test's event-associated visits are counted
        // (deterministic — otherProgramId/global data can't leak in). Two visits qualify:
        // the enrolled adult (3h) and the non-enrolled youth (2h).
        const res = await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${programId}`);
        expect(res.status).toBe(200);
        const data = await res.json();

        // Enrolled ADULT counts as a participant — age (35+) does not demote them.
        expect(data.totals.uniqueParticipants).toBe(1);
        expect(data.totals.totalParticipantHours).toBe(3);
        // Non-enrolled YOUTH counts as a volunteer — age (<18) does not make them a participant.
        expect(data.totals.uniqueVolunteers).toBe(1);
        expect(data.totals.totalVolunteerHours).toBe(2);
    });

    it('scopes to a single program via programId', async () => {
        const res = await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${otherProgramId}`);
        expect(res.status).toBe(200);
        const data = await res.json();
        // No visits are associated with otherProgramId's events (it has none) — empty result.
        expect(data.buckets).toEqual([]);
        expect(data.totals.uniqueVolunteers).toBe(0);
        expect(data.totals.uniqueParticipants).toBe(0);
    });
});
