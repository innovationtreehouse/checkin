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
 * unstructured hours, the `arrivedVia=LEAD_MARKED` exclusion (synthetic "marked
 * present" visits, plus its pre-split `SYSTEM` spelling) and the cases it must
 * not swallow — an untagged arrival, a real visit whose time staff corrected via
 * the staff route, and a member's self-correction (#1631) — plus the `programId`
 * filter and the invalid-period 400. Corrections are driven through the real
 * PATCH routes, since a hand-built fixture cannot catch a wrong stamp.
 */

import { GET } from '@/app/api/facility/trends/route';
import { PATCH } from '@/app/api/facility/visits/route';
import { PATCH as MANUAL_PATCH } from '@/app/api/attendance/manual/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { getAppSettings } from '@/lib/appSettings';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

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
    let untaggedProgramId: number;
    let eventId: number;
    let untaggedEventId: number;
    const visitIds: number[] = [];

    // Every seeded arrival hangs off one anchor, a few minutes apart and at least an hour
    // into the month, so the whole seed lands in a single calendar-month bucket no matter
    // when the suite runs. The route buckets on arrivedAt only, so departures that spill
    // past midnight into the next month are fine.
    //
    // The month the anchor sits in is the ORG timezone's, since that is what the route
    // buckets against — resolved in beforeAll because the zone comes from AppSettings.
    let ANCHOR: Date;
    // The bucket the assertions inspect, keyed the way the route keys it (org-zone month start).
    let BUCKET_START: Date;
    const arrival = (minutesBefore: number) => new Date(ANCHOR.getTime() - minutesBefore * 60 * 1000);
    const departure = (minutesBefore: number, hours: number) =>
        new Date(arrival(minutesBefore).getTime() + hours * 60 * 60 * 1000);

    beforeAll(async () => {
        const { timezone } = await getAppSettings();
        const monthStart = (d: Date) => {
            const z = toZonedTime(d, timezone);
            z.setDate(1);
            z.setHours(0, 0, 0, 0);
            return fromZonedTime(z, timezone);
        };
        const NOW = new Date();
        ANCHOR = new Date(Math.max(NOW.getTime(), monthStart(NOW).getTime() + 60 * 60 * 1000));
        BUCKET_START = monthStart(ANCHOR);

        const admin = await prisma.person.create({
            data: { email: `admin-${TAG}@example.com`, name: 'Admin', isSysadmin: true, household: { create: { name: "Test HH" } } },
        });
        adminId = admin.id;
        householdId = admin.householdId;

        const volunteer = await prisma.person.create({
            data: { email: `volunteer-${TAG}@example.com`, name: 'Volunteer', dateOfBirth: new Date('1980-01-01'), householdId },
        });
        volunteerId = volunteer.id;
        const enrolledAdult = await prisma.person.create({
            data: { email: `enrolled-${TAG}@example.com`, name: 'Enrolled Adult', dateOfBirth: new Date('1985-01-01'), householdId },
        });
        enrolledAdultId = enrolledAdult.id;
        const youth = await prisma.person.create({
            data: { email: `youth-${TAG}@example.com`, name: 'Youth', dateOfBirth: new Date('2015-01-01'), householdId },
        });
        youthId = youth.id;

        const program = await prisma.program.create({ data: { name: `Prog ${TAG}` } });
        programId = program.id;
        const otherProgram = await prisma.program.create({ data: { name: `Other ${TAG}` } });
        otherProgramId = otherProgram.id;
        const event = await prisma.event.create({
            data: { programId, name: `Event ${TAG}`, startAt: arrival(2), endAt: departure(2, 3) },
        });
        eventId = event.id;

        // Enroll the adult in `programId` (ACTIVE) — this, not their age, makes them a participant.
        await prisma.programParticipant.create({
            data: { programId, personId: enrolledAdultId, status: 'ACTIVE' },
        });

        // Structured visit (associated to the event): enrolled adult, 3 hours -> participant.
        const structured = await prisma.visit.create({
            data: { personId: enrolledAdultId, arrivedAt: arrival(2), departedAt: departure(2, 3), arrivedVia: 'SCANNER', associatedEventId: eventId },
        });
        // Structured visit (associated to the event): non-enrolled youth, 2 hours -> volunteer.
        const youthStructured = await prisma.visit.create({
            data: { personId: youthId, arrivedAt: arrival(2), departedAt: departure(2, 2), arrivedVia: 'SCANNER', associatedEventId: eventId },
        });
        // Unstructured visit (no event): non-enrolled adult volunteer, 1 hour.
        const unstructured = await prisma.visit.create({
            data: { personId: volunteerId, arrivedAt: arrival(1), departedAt: departure(1, 1), arrivedVia: 'WEB' },
        });
        // Synthetic "marked present" visit (arrivedVia LEAD_MARKED) — the event
        // window is a placeholder, not measured time, so it is excluded entirely.
        const synthetic = await prisma.visit.create({
            data: { personId: volunteerId, arrivedAt: arrival(2), departedAt: departure(2, 3), arrivedVia: 'LEAD_MARKED', associatedEventId: eventId },
        });
        // The same thing in its pre-split spelling. A rolling deploy's drain
        // window lets the previous release keep writing SYSTEM, so the exclusion
        // must still catch it — 3h that must not reach structuredHours.
        const legacySynthetic = await prisma.visit.create({
            data: { personId: volunteerId, arrivedAt: arrival(3), departedAt: departure(3, 3), arrivedVia: 'SYSTEM', associatedEventId: eventId },
        });
        // Still-open visit (no departedAt) — excluded (departedAt: { not: null } in the where).
        const open = await prisma.visit.create({
            data: { personId: youthId, arrivedAt: arrival(0), arrivedVia: 'WEB' },
        });
        // A program of its own, so the untagged-arrival assertions can scope by
        // programId and be exact instead of leaning on the shared month bucket.
        const untaggedProgram = await prisma.program.create({ data: { name: `Untagged ${TAG}` } });
        untaggedProgramId = untaggedProgram.id;
        const untaggedEvent = await prisma.event.create({
            data: { programId: untaggedProgramId, name: `Untagged event ${TAG}`, startAt: arrival(2), endAt: departure(2, 3) },
        });
        untaggedEventId = untaggedEvent.id;
        // Arrival with no source recorded: an ordinary visit, 2h, counted.
        const untagged = await prisma.visit.create({
            data: { personId: volunteerId, arrivedAt: arrival(2), departedAt: departure(2, 2), arrivedVia: null, associatedEventId: untaggedEventId },
        });
        // Staff-asserted arrival in the same program, 3h, still excluded.
        const untaggedProgramSynthetic = await prisma.visit.create({
            data: { personId: youthId, arrivedAt: arrival(2), departedAt: departure(2, 3), arrivedVia: 'LEAD_MARKED', associatedEventId: untaggedEventId },
        });

        visitIds.push(structured.id, youthStructured.id, unstructured.id, synthetic.id, legacySynthetic.id, open.id,
            untagged.id, untaggedProgramSynthetic.id);
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({ where: { id: { in: visitIds } } });
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.event.deleteMany({ where: { id: { in: [eventId, untaggedEventId] } } });
        await prisma.program.deleteMany({ where: { id: { in: [programId, otherProgramId, untaggedProgramId] } } });
        await prisma.person.deleteMany({ where: { id: { in: [adminId, volunteerId, enrolledAdultId, youthId] } } });
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

        // Look the anchor's bucket up by periodStart: the seed's month is not necessarily
        // the last bucket, since any unrelated visit in a later month adds one.
        expect(data.buckets.map((b: { periodStart: string }) => b.periodStart)).toContain(BUCKET_START.toISOString());
        const thisMonth = data.buckets.find((b: { periodStart: string }) => b.periodStart === BUCKET_START.toISOString());
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

    // The source filter is written as a NOT IN, and in SQL a NULL never satisfies
    // one — so an arrival with no source recorded drops out of the chart entirely
    // unless it is admitted explicitly.
    it('counts an untagged arrival and still drops the staff-marked one', async () => {
        const res = await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${untaggedProgramId}`);
        expect(res.status).toBe(200);
        const data = await res.json();

        // The 2h untagged visit, and only it — the 3h LEAD_MARKED visit in the same
        // program is excluded, so its person never appears either.
        expect(data.totals.uniqueVolunteers).toBe(1);
        expect(data.totals.totalVolunteerHours).toBe(2);
        expect(data.totals.uniqueParticipants).toBe(0);
        expect(data.totals.structuredHours).toBe(2);
    });

    // Driven through the PATCH route on purpose. Every other case here builds its
    // `arrivedVia` by hand, so both the correct behaviour and the broken one pass
    // them — only calling the real correction path can catch a wrong stamp.
    //
    // A board member fixing a badge time must not delete the visit's hours. The
    // exclusion is for visits only a third party asserts happened (LEAD_MARKED);
    // this one was scanned, so correcting its arrival re-times it, never removes it.
    it('keeps a corrected scanner visit in the hours after a staff PATCH', async () => {
        const program = await prisma.program.create({ data: { name: `Corrected ${TAG}` } });
        const event = await prisma.event.create({
            data: { programId: program.id, name: `Corrected event ${TAG}`, startAt: arrival(2), endAt: departure(2, 3) },
        });
        // Both ends in the past: the PATCH route rejects a future time, and the
        // shared `departure()` helper lands hours ahead of now.
        const now = Date.now();
        const visit = await prisma.visit.create({
            data: {
                personId: volunteerId,
                arrivedAt: new Date(now - 4 * 3600000),
                departedAt: new Date(now - 2 * 3600000),
                arrivedVia: 'SCANNER',
                departedVia: 'SCANNER',
                associatedEventId: event.id,
            },
        });
        visitIds.push(visit.id);

        const before = await (await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${program.id}`)).json();
        expect(before.totals.totalVolunteerHours).toBe(2);

        // The board fixes the arrival: the member badged in an hour later than recorded.
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const patch = await PATCH(new Request('http://localhost:4000/api/facility/visits', {
            method: 'PATCH',
            body: JSON.stringify({ visitId: visit.id, arrivedAt: new Date(now - 3 * 3600000).toISOString() }),
        }) as unknown as import('next/server').NextRequest);
        expect(patch.status).toBe(200);

        // Still counted, now at the corrected 1h. Restamping the arrival
        // LEAD_MARKED would make these 0 — the visit would vanish from the trend
        // for having been fixed.
        const after = await (await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${program.id}`)).json();
        expect(after.totals.uniqueVolunteers).toBe(1);
        expect(after.totals.totalVolunteerHours).toBe(1);
        expect(after.totals.structuredHours).toBe(1);

        await prisma.auditLog.deleteMany({ where: { tableName: 'Visit', affectedEntityId: visit.id } });
        await prisma.visit.delete({ where: { id: visit.id } });
        await prisma.event.delete({ where: { id: event.id } });
        await prisma.program.delete({ where: { id: program.id } });
    });

    // #1631 pin: PATCH /api/attendance/manual/[id] (member self-correction) must
    // not restamp arrivedVia WEB. Before the fix, correcting the arrival time of
    // a LEAD_MARKED (staff-asserted) visit promoted it past the trends filter —
    // it started counting as measured hours the moment its time was fixed.
    it('keeps a self-corrected LEAD_MARKED visit excluded from trends hours', async () => {
        const program = await prisma.program.create({ data: { name: `SelfCorrectedLM ${TAG}` } });
        const event = await prisma.event.create({
            data: { programId: program.id, name: `SelfCorrectedLM event ${TAG}`, startAt: arrival(2), endAt: departure(2, 3) },
        });
        const now = Date.now();
        const visit = await prisma.visit.create({
            data: {
                personId: volunteerId,
                arrivedAt: new Date(now - 4 * 3600000),
                departedAt: new Date(now - 2 * 3600000),
                arrivedVia: 'LEAD_MARKED',
                departedVia: 'LEAD_MARKED',
                associatedEventId: event.id,
            },
        });
        visitIds.push(visit.id);

        const before = await (await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${program.id}`)).json();
        expect(before.totals.totalVolunteerHours).toBe(0);

        // The member corrects their own arrival — a household lead is not needed here.
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: volunteerId } });
        const patch = await MANUAL_PATCH(new Request(`http://localhost:4000/api/attendance/manual/${visit.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ arrivedAt: new Date(now - 3 * 3600000).toISOString() }),
        }) as unknown as import('next/server').NextRequest, { params: Promise.resolve({ id: String(visit.id) }) } as never);
        expect(patch.status).toBe(200);
        const patched = await prisma.visit.findUnique({ where: { id: visit.id } });
        expect(patched?.arrivedVia).toBe('LEAD_MARKED'); // not restamped WEB

        // Still 0 — restamping WEB would have promoted this into 1h of counted hours.
        const after = await (await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${program.id}`)).json();
        expect(after.totals.uniqueVolunteers).toBe(0);
        expect(after.totals.totalVolunteerHours).toBe(0);
        expect(after.totals.structuredHours).toBe(0);

        await prisma.auditLog.deleteMany({ where: { tableName: 'Visit', affectedEntityId: visit.id } });
        await prisma.visit.delete({ where: { id: visit.id } });
        await prisma.event.delete({ where: { id: event.id } });
        await prisma.program.delete({ where: { id: program.id } });
    });

    // Control for the same fix: a WEB/SCANNER visit's self-correction is
    // otherwise unchanged — it still applies and still counts, same as before.
    it('keeps a self-corrected SCANNER visit counted after the manual PATCH route', async () => {
        const program = await prisma.program.create({ data: { name: `SelfCorrectedScanner ${TAG}` } });
        const event = await prisma.event.create({
            data: { programId: program.id, name: `SelfCorrectedScanner event ${TAG}`, startAt: arrival(2), endAt: departure(2, 3) },
        });
        const now = Date.now();
        const visit = await prisma.visit.create({
            data: {
                personId: volunteerId,
                arrivedAt: new Date(now - 4 * 3600000),
                departedAt: new Date(now - 2 * 3600000),
                arrivedVia: 'SCANNER',
                departedVia: 'SCANNER',
                associatedEventId: event.id,
            },
        });
        visitIds.push(visit.id);

        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: volunteerId } });
        const patch = await MANUAL_PATCH(new Request(`http://localhost:4000/api/attendance/manual/${visit.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ arrivedAt: new Date(now - 3 * 3600000).toISOString() }),
        }) as unknown as import('next/server').NextRequest, { params: Promise.resolve({ id: String(visit.id) }) } as never);
        expect(patch.status).toBe(200);
        const patched = await prisma.visit.findUnique({ where: { id: visit.id } });
        expect(patched?.arrivedVia).toBe('SCANNER'); // not restamped WEB either — just no longer restamped at all

        const after = await (await callAs({ id: adminId, isSysadmin: true }, `?period=month&programId=${program.id}`)).json();
        expect(after.totals.uniqueVolunteers).toBe(1);
        expect(after.totals.totalVolunteerHours).toBe(1);
        expect(after.totals.structuredHours).toBe(1);

        await prisma.auditLog.deleteMany({ where: { tableName: 'Visit', affectedEntityId: visit.id } });
        await prisma.visit.delete({ where: { id: visit.id } });
        await prisma.event.delete({ where: { id: event.id } });
        await prisma.program.delete({ where: { id: program.id } });
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
