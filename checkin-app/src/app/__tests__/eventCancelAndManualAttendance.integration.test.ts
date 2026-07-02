/**
 * @jest-environment node
 */
/**
 * Integration tests for three write paths in PATCH /api/events/[id] that can
 * corrupt attendance / safety data:
 *
 *   1. CANCEL (single + recurring series) — transactional; visits NULLed, not deleted.
 *   2. manualEditAttendance vs. an OPEN scan visit (Present update / Absent reject).
 *   3. PAST-EVENT edit guard (editTime on a finished event is rejected).
 *
 * Harness mirrors eventRescheduleClearsReminder.integration.test.ts.
 *
 * BUG 2 (manual "Absent" deleting a live/open check-in) is now FIXED: an Absent
 * edit against an OPEN visit (departedAt = null) is rejected with 400 so the row
 * proving the participant is physically on-site survives. Only CLOSED visits are
 * removed on an Absent correction. See the manualEditAttendance block below.
 */
import { PATCH } from '@/app/api/events/[id]/route';
import { GET as cronReminders } from '@/app/api/cron/reminders/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { sendNotification } from '@/lib/notifications';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn().mockResolvedValue(undefined),
}));

const TAG = 'event-cancel-manual-test';
const SECRET = 'event-cancel-manual-secret';
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function patch(eventId: number, body: Record<string, unknown>) {
    const req = new Request('http://localhost/api/events/x', {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
    return PATCH(req as unknown as import("next/server").NextRequest, { params: Promise.resolve({ id: String(eventId) }) });
}

function cronReq() {
    return new Request('http://localhost/api/cron/reminders', {
        method: 'GET',
        headers: { authorization: `Bearer ${SECRET}` },
    }) as unknown as import('next/server').NextRequest;
}

describe('PATCH /api/events/[id] — cancel, manual attendance, past-event guard', () => {
    let adminId: number;
    let adminHouseholdId: number;
    let participantId: number;
    let householdId: number;

    beforeAll(async () => {
        const admin = await prisma.participant.create({
            data: { name: 'Cancel Admin', email: `admin-${TAG}@example.com`, isSysadmin: true, household: { create: {} } },
        });
        adminId = admin.id;
        adminHouseholdId = admin.householdId;

        const p = await prisma.participant.create({
            data: { name: 'Cancel Attendee', email: `attendee-${TAG}@example.com`, household: { create: {} } },
        });
        participantId = p.id;
        householdId = p.householdId;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = SECRET;
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
    });

    afterEach(async () => {
        await prisma.visit.deleteMany({ where: { personId: participantId } });
        await prisma.rSVP.deleteMany({ where: { personId: participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({ where: { personId: participantId } });
        await prisma.rSVP.deleteMany({ where: { personId: participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.participant.deleteMany({ where: { id: { in: [adminId, participantId] } } });
        await prisma.household.deleteMany({ where: { id: { in: [adminHouseholdId, householdId] } } });
    });

    function makeEvent(label: string, startOffsetMs: number, recurringGroupId?: string) {
        const start = new Date(Date.now() + startOffsetMs);
        return prisma.event.create({
            data: {
                name: `${TAG} ${label}`,
                startAt: start,
                endAt: new Date(start.getTime() + HOUR),
                description: 'x',
                ...(recurringGroupId ? { recurringGroupId } : {}),
            },
        });
    }

    // ─── 1. CANCEL ──────────────────────────────────────────────────────────

    describe('cancel — single event', () => {
        it('deletes RSVPs, NULLs visits (does not delete them), and deletes the event', async () => {
            const event = await makeEvent('single-cancel', 2 * HOUR);
            await prisma.rSVP.create({ data: { eventId: event.id, personId: participantId, status: 'ATTENDING' } });
            const visit = await prisma.visit.create({
                data: { personId: participantId, arrivedAt: new Date(), associatedEventId: event.id },
            });

            const res = await patch(event.id, { action: 'cancel' });
            expect(res.status).toBe(200);

            // RSVP gone.
            expect(await prisma.rSVP.findUnique({
                where: { eventId_personId: { eventId: event.id, personId: participantId } },
            })).toBeNull();

            // Visit survives, but its event link is nulled (NOT deleted).
            const survivingVisit = await prisma.visit.findUnique({ where: { id: visit.id } });
            expect(survivingVisit).not.toBeNull();
            expect(survivingVisit!.associatedEventId).toBeNull();

            // Event gone.
            expect(await prisma.event.findUnique({ where: { id: event.id } })).toBeNull();
        });
    });

    describe('cancel — applyToFuture series', () => {
        it('removes only events with start >= the target; PAST events in the series survive', async () => {
            const group = `${TAG}-group`;
            const past = await makeEvent('series-past', -48 * HOUR, group);
            const target = await makeEvent('series-target', 2 * HOUR, group);
            const future = await makeEvent('series-future', 26 * HOUR, group);

            const res = await patch(target.id, { action: 'cancel', applyToFuture: true });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.count).toBe(2); // target + future

            // Past untouched.
            expect(await prisma.event.findUnique({ where: { id: past.id } })).not.toBeNull();
            // Target + future removed.
            expect(await prisma.event.findUnique({ where: { id: target.id } })).toBeNull();
            expect(await prisma.event.findUnique({ where: { id: future.id } })).toBeNull();
        });
    });

    // ─── 2. MANUAL ATTENDANCE × OPEN SCAN VISIT ─────────────────────────────

    describe('manualEditAttendance — Present with an open scan visit', () => {
        it('UPDATES the existing open visit instead of creating a second one', async () => {
            const event = await makeEvent('manual-present', -1 * HOUR);
            const openArrival = new Date(Date.now() - 90 * MIN);
            const openVisit = await prisma.visit.create({
                data: { personId: participantId, arrivedAt: openArrival, departedAt: null, associatedEventId: event.id },
            });

            const newArrival = new Date(Date.now() - 80 * MIN);
            const res = await patch(event.id, {
                action: 'manualEditAttendance',
                participantId,
                status: 'Present',
                arrivedAt: newArrival.toISOString(),
            });
            expect(res.status).toBe(200);

            const visits = await prisma.visit.findMany({ where: { personId: participantId, associatedEventId: event.id } });
            expect(visits.length).toBe(1);               // not a second visit
            expect(visits[0].id).toBe(openVisit.id);     // same row, updated in place
            expect(visits[0].arrivedAt.getTime()).toBe(newArrival.getTime());
        });
    });

    describe('manualEditAttendance — Absent vs open/closed visits', () => {
        // An OPEN visit (departedAt = null) is proof the participant physically
        // scanned in and is still on-site. Marking them Absent must NOT erase it.
        it('rejects Absent on a live (open) check-in and keeps the visit', async () => {
            const event = await makeEvent('manual-absent-open', -1 * HOUR);
            await prisma.visit.create({
                data: { personId: participantId, arrivedAt: new Date(Date.now() - 30 * MIN), departedAt: null, associatedEventId: event.id },
            });

            const res = await patch(event.id, { action: 'manualEditAttendance', participantId, status: 'Absent' });
            expect(res.status).toBe(400);

            const visits = await prisma.visit.findMany({ where: { personId: participantId, associatedEventId: event.id } });
            expect(visits.length).toBe(1); // open visit survives
        });

        it('deletes a closed (departedAt) visit when marking Absent', async () => {
            const event = await makeEvent('manual-absent-closed', -2 * HOUR);
            await prisma.visit.create({
                data: {
                    personId: participantId,
                    arrivedAt: new Date(Date.now() - 90 * MIN),
                    departedAt: new Date(Date.now() - 60 * MIN),
                    associatedEventId: event.id,
                },
            });

            const res = await patch(event.id, { action: 'manualEditAttendance', participantId, status: 'Absent' });
            expect(res.status).toBe(200);

            const visits = await prisma.visit.findMany({ where: { personId: participantId, associatedEventId: event.id } });
            expect(visits.length).toBe(0); // closed visit removed
        });

        it('rejects and deletes nothing when an open visit coexists with a closed one', async () => {
            const event = await makeEvent('manual-absent-mix', -2 * HOUR);
            await prisma.visit.create({
                data: {
                    personId: participantId,
                    arrivedAt: new Date(Date.now() - 110 * MIN),
                    departedAt: new Date(Date.now() - 80 * MIN),
                    associatedEventId: event.id,
                },
            });
            await prisma.visit.create({
                data: { personId: participantId, arrivedAt: new Date(Date.now() - 30 * MIN), departedAt: null, associatedEventId: event.id },
            });

            const res = await patch(event.id, { action: 'manualEditAttendance', participantId, status: 'Absent' });
            expect(res.status).toBe(400);

            // All-or-nothing: the open visit blocks the edit, so the closed one stays too.
            const visits = await prisma.visit.findMany({ where: { personId: participantId, associatedEventId: event.id } });
            expect(visits.length).toBe(2);
        });
    });

    // ─── 3. PAST-EVENT GUARD ────────────────────────────────────────────────

    describe('past-event editTime — rejected', () => {
        // Editing a finished event is blocked (400) before any write, so a stale
        // reminderSentAt is never re-cleared and no past-event reminder can re-arm.
        it('rejects the edit and leaves reminderSentAt untouched', async () => {
            const event = await makeEvent('past-edit', -2 * HOUR);
            const sentAt = new Date();
            await prisma.rSVP.create({
                data: { eventId: event.id, personId: participantId, status: 'ATTENDING', reminderSentAt: sentAt },
            });

            const newStart = new Date(Date.now() - 90 * MIN);
            const res = await patch(event.id, { action: 'editTime', startAt: newStart.toISOString() });
            expect(res.status).toBe(400);

            // Guard fires before the clear → reminderSentAt preserved.
            const rsvp = await prisma.rSVP.findUnique({
                where: { eventId_personId: { eventId: event.id, personId: participantId } },
            });
            expect(rsvp!.reminderSentAt).not.toBeNull();

            // And the cron still won't re-notify for a past start.
            const cron = await cronReminders(cronReq());
            expect(cron.status).toBe(200);
            expect((sendNotification as jest.Mock).mock.calls.length).toBe(0);
        });
    });
});
