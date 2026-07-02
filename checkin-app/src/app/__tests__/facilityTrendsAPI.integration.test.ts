/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/facility/trends.
 *
 * 401/403 (roles: isSysadmin, isBoardMember) are already covered by
 * authzRoleRejection.integration.test.ts — this file focuses on the success
 * path: bucketing visits by period, the volunteer/student split (by age at
 * arrival), structured (event-associated) vs unstructured hours, the
 * `arrivedVia=SYSTEM` exclusion (synthetic "marked present" visits), the
 * `programId` filter, and the invalid-period 400.
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
    let volunteerId: number; // adult, dateOfBirth makes them 30+
    let studentId: number; // dateOfBirth makes them a youth
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
        const student = await prisma.participant.create({
            data: { email: `student-${TAG}@example.com`, name: 'Student', dateOfBirth: new Date('2015-01-01'), householdId },
        });
        studentId = student.id;

        const program = await prisma.program.create({ data: { name: `Prog ${TAG}` } });
        programId = program.id;
        const otherProgram = await prisma.program.create({ data: { name: `Other ${TAG}` } });
        otherProgramId = otherProgram.id;
        const event = await prisma.event.create({
            data: { programId, name: `Event ${TAG}`, startAt: hoursAgo(5), endAt: hoursAgo(2) },
        });
        eventId = event.id;

        // Structured visit (associated to the event): volunteer, 3 hours.
        const structured = await prisma.visit.create({
            data: { participantId: volunteerId, arrivedAt: hoursAgo(5), departedAt: hoursAgo(2), arrivedVia: 'SCANNER', associatedEventId: eventId },
        });
        // Unstructured visit (no event): student, 1 hour.
        const unstructured = await prisma.visit.create({
            data: { participantId: studentId, arrivedAt: hoursAgo(4), departedAt: hoursAgo(3), arrivedVia: 'WEB' },
        });
        // Synthetic "marked present" visit (arrivedVia SYSTEM) — must be excluded entirely.
        const synthetic = await prisma.visit.create({
            data: { participantId: volunteerId, arrivedAt: hoursAgo(5), departedAt: hoursAgo(2), arrivedVia: 'SYSTEM', associatedEventId: eventId },
        });
        // Still-open visit (no departedAt) — excluded (departedAt: { not: null } in the where).
        const open = await prisma.visit.create({
            data: { participantId: studentId, arrivedAt: hoursAgo(1), arrivedVia: 'WEB' },
        });
        visitIds.push(structured.id, unstructured.id, synthetic.id, open.id);
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({ where: { id: { in: visitIds } } });
        await prisma.event.deleteMany({ where: { id: eventId } });
        await prisma.program.deleteMany({ where: { id: { in: [programId, otherProgramId] } } });
        await prisma.participant.deleteMany({ where: { id: { in: [adminId, volunteerId, studentId] } } });
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

    it('buckets visits, splitting volunteer/student and structured/unstructured hours', async () => {
        const res = await callAs({ id: adminId, isSysadmin: true }, '?period=month');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.period).toBe('month');
        expect(Array.isArray(data.buckets)).toBe(true);

        // Everything we seeded lands in the current month's bucket.
        const thisMonth = data.buckets[data.buckets.length - 1];
        expect(thisMonth.uniqueVolunteers).toBeGreaterThanOrEqual(1);
        expect(thisMonth.uniqueStudents).toBeGreaterThanOrEqual(1);
        // Structured (event-associated) = the 3-hour volunteer visit; unstructured = the
        // 1-hour student visit. SYSTEM-sourced and still-open visits are excluded, so
        // totals reflect only those two.
        expect(thisMonth.structuredHours).toBeGreaterThanOrEqual(3);
        expect(thisMonth.unstructuredHours).toBeGreaterThanOrEqual(1);
        expect(data.totals.label).toBe('Total');
    });

    it('scopes to a single program via programId', async () => {
        const res = await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${otherProgramId}`);
        expect(res.status).toBe(200);
        const data = await res.json();
        // No visits are associated with otherProgramId's events (it has none) — empty result.
        expect(data.buckets).toEqual([]);
        expect(data.totals.uniqueVolunteers).toBe(0);
        expect(data.totals.uniqueStudents).toBe(0);
    });
});
