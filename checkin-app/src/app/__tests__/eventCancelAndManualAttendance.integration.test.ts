/**
 * @jest-environment node
 */
/**
 * Integration tests for three previously-untested write paths in
 * PATCH /api/events/[id] that can corrupt attendance / safety data:
 *
 *   1. CANCEL (single + recurring series) — currently NON-TRANSACTIONAL.
 *   2. manualEditAttendance vs. an OPEN scan visit (Present update / Absent delete).
 *   3. PAST-EVENT edit re-clearing reminderSentAt (no guard exists).
 *
 * Harness mirrors eventRescheduleClearsReminder.integration.test.ts.
 *
 * ─── FLAGGED BUGS / BEHAVIORS (not fixed here — flag-don't-fix) ──────────────
 *
 * BUG 1 — single cancel is NOT transactional (route.ts:155-159).
 *   deleteMany(RSVP) → updateMany(Visit→null) → delete(Event) run as three
 *   separate writes. A failure between writes orphans visits (associatedEventId
 *   already nulled) or leaves RSVPs deleted with the event still alive. The
 *   series editTime path right above it (route.ts:149) already wraps its writes
 *   in prisma.$transaction — single cancel should too. LEFT UNFIXED + no
 *   partial-failure rollback test: forcing a mid-sequence failure needs a prisma
 *   mock (the route swallows nothing — the delete just has to throw), which is a
 *   code change to the route, and the top-line instruction is flag-don't-fix.
 *   Fix is a 3-line wrap matching route.ts:149.
 *
 * BUG 2 — manual "Absent" silently DELETES a live (open) check-in
 *   (route.ts:194-201). deleteMany keys on (participantId, associatedEventId)
 *   with no departed filter, so marking someone Absent erases the visit row
 *   proving they physically scanned in and are still on-site. That destroys a
 *   safety record (who is in the building). Asserted as current behavior below;
 *   flagged as likely wrong — an Absent edit on an OPEN visit should arguably be
 *   rejected, or close the visit rather than delete it.
 *
 * BUG 3 — no past-event guard (route.ts:171-176). Editing a finished event's
 *   start re-clears reminderSentAt. The cron's window is future-only
 *   (start gte now+2h, reminders/route.ts:38), so a past start is never picked
 *   up and no stale reminder actually fires — see the regression test below,
 *   which locks that in. The clear itself is still latent garbage: the only
 *   thing preventing a past-event reminder is the cron window, not any guard on
 *   the write. A start guard (PATCH past event → 400) would be the real fix.
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
    return PATCH(req, { params: Promise.resolve({ id: String(eventId) }) });
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
            data: { name: 'Cancel Admin', email: `admin-${TAG}@example.com`, sysadmin: true, household: { create: {} } },
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
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });
    });

    afterEach(async () => {
        await prisma.visit.deleteMany({ where: { participantId } });
        await prisma.rSVP.deleteMany({ where: { participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
    });

    afterAll(async () => {
        await prisma.visit.deleteMany({ where: { participantId } });
        await prisma.rSVP.deleteMany({ where: { participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.participant.deleteMany({ where: { id: { in: [adminId, participantId] } } });
        await prisma.household.deleteMany({ where: { id: { in: [adminHouseholdId, householdId] } } });
    });

    function makeEvent(label: string, startOffsetMs: number, recurringGroupId?: string) {
        const start = new Date(Date.now() + startOffsetMs);
        return prisma.event.create({
            data: {
                name: `${TAG} ${label}`,
                start,
                end: new Date(start.getTime() + HOUR),
                description: 'x',
                ...(recurringGroupId ? { recurringGroupId } : {}),
            },
        });
    }

    // ─── 1. CANCEL ──────────────────────────────────────────────────────────

    describe('cancel — single event', () => {
        it('deletes RSVPs, NULLs visits (does not delete them), and deletes the event', async () => {
            const event = await makeEvent('single-cancel', 2 * HOUR);
            await prisma.rSVP.create({ data: { eventId: event.id, participantId, status: 'ATTENDING' } });
            const visit = await prisma.visit.create({
                data: { participantId, arrived: new Date(), associatedEventId: event.id },
            });

            const res = await patch(event.id, { action: 'cancel' });
            expect(res.status).toBe(200);

            // RSVP gone.
            expect(await prisma.rSVP.findUnique({
                where: { eventId_participantId: { eventId: event.id, participantId } },
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
                data: { participantId, arrived: openArrival, departed: null, associatedEventId: event.id },
            });

            const newArrival = new Date(Date.now() - 80 * MIN);
            const res = await patch(event.id, {
                action: 'manualEditAttendance',
                participantId,
                status: 'Present',
                arrived: newArrival.toISOString(),
            });
            expect(res.status).toBe(200);

            const visits = await prisma.visit.findMany({ where: { participantId, associatedEventId: event.id } });
            expect(visits.length).toBe(1);               // not a second visit
            expect(visits[0].id).toBe(openVisit.id);     // same row, updated in place
            expect(visits[0].arrived.getTime()).toBe(newArrival.getTime());
        });
    });

    describe('manualEditAttendance — Absent on a live (open) check-in', () => {
        // BUG 2: deleting an OPEN visit erases the record that this person is
        // physically on-site. Asserting current behavior; flagged above.
        it('DELETES the open visit (destroys the live check-in / safety record)', async () => {
            const event = await makeEvent('manual-absent', -1 * HOUR);
            await prisma.visit.create({
                data: { participantId, arrived: new Date(Date.now() - 30 * MIN), departed: null, associatedEventId: event.id },
            });

            const res = await patch(event.id, { action: 'manualEditAttendance', participantId, status: 'Absent' });
            expect(res.status).toBe(200);

            const visits = await prisma.visit.findMany({ where: { participantId, associatedEventId: event.id } });
            expect(visits.length).toBe(0); // open visit silently removed
        });
    });

    // ─── 3. PAST-EVENT GUARD (regression) ───────────────────────────────────

    describe('past-event editTime — reminder is not re-sent', () => {
        // BUG 3: editing a past event re-clears reminderSentAt with no guard.
        // The cron's future-only window is the only thing stopping a stale
        // past-event reminder. This locks that in.
        it('clears reminderSentAt but the cron does NOT re-notify for a past start', async () => {
            const event = await makeEvent('past-edit', -2 * HOUR);
            await prisma.rSVP.create({
                data: { eventId: event.id, participantId, status: 'ATTENDING', reminderSentAt: new Date() },
            });

            // Edit the (still past) start. Route clears reminderSentAt unconditionally.
            const newStart = new Date(Date.now() - 90 * MIN);
            const res = await patch(event.id, { action: 'editTime', start: newStart.toISOString() });
            expect(res.status).toBe(200);

            const cleared = await prisma.rSVP.findUnique({
                where: { eventId_participantId: { eventId: event.id, participantId } },
            });
            expect(cleared!.reminderSentAt).toBeNull(); // route DID re-clear (latent bug)

            // Cron window is [now+2h, now+2h15m]; a past start is excluded → no send.
            const cron = await cronReminders(cronReq());
            expect(cron.status).toBe(200);
            expect((sendNotification as jest.Mock).mock.calls.length).toBe(0);

            // And reminderSentAt stays null because the cron never touched it.
            const after = await prisma.rSVP.findUnique({
                where: { eventId_participantId: { eventId: event.id, participantId } },
            });
            expect(after!.reminderSentAt).toBeNull();
        });
    });
});
