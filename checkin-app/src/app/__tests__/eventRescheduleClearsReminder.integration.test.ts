/**
 * @jest-environment node
 */
/**
 * Integration tests for the reschedule → clear-reminder behavior.
 *
 * `RSVP.reminderSentAt` dedups event reminders per-RSVP. Because it is never
 * cleared on its own, a rescheduled event would otherwise never re-remind
 * already-notified attendees. PATCH /api/events/[id] with action 'editTime'
 * now clears `reminderSentAt` for the affected RSVPs when (and only when) the
 * event's START moves, so the cron picks them up for a fresh 2h reminder.
 *
 * Covered:
 *   - single-event start shift clears reminderSentAt; cron then re-notifies
 *   - end-only edit (start unchanged) does NOT clear
 *   - applyToFuture series shift clears reminderSentAt across the series
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

const TAG = 'reschedule-clears-test';
const SECRET = 'reschedule-clears-secret';
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function patchReq(body: Record<string, unknown>) {
    return new Request('http://localhost/api/events/x', {
        method: 'PATCH',
        body: JSON.stringify(body),
    });
}

function patch(eventId: number, body: Record<string, unknown>) {
    return PATCH(patchReq(body), { params: Promise.resolve({ id: String(eventId) }) });
}

function cronReq() {
    return new Request('http://localhost/api/cron/reminders', {
        method: 'GET',
        headers: { authorization: `Bearer ${SECRET}` },
    }) as unknown as import('next/server').NextRequest;
}

describe('PATCH /api/events/[id] editTime — clears reminderSentAt on reschedule', () => {
    let participantId: number;
    let householdId: number;
    let adminId: number;
    let adminHouseholdId: number;

    beforeAll(async () => {
        const p = await prisma.participant.create({
            data: { name: 'Reschedule Attendee', email: `attendee-${TAG}@example.com`, household: { create: {} } },
        });
        participantId = p.id;
        householdId = p.householdId;

        const admin = await prisma.participant.create({
            data: { name: 'Reschedule Admin', email: `admin-${TAG}@example.com`, household: { create: {} } },
        });
        adminId = admin.id;
        adminHouseholdId = admin.householdId;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = SECRET;
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, sysadmin: true } });
    });

    afterEach(async () => {
        await prisma.rSVP.deleteMany({ where: { participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
    });

    afterAll(async () => {
        await prisma.rSVP.deleteMany({ where: { participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.participant.deleteMany({ where: { id: { in: [participantId, adminId] } } });
        await prisma.household.deleteMany({ where: { id: { in: [householdId, adminHouseholdId] } } });
    });

    async function makeEvent(label: string, startOffsetMs: number, recurringGroupId?: string) {
        const start = new Date(Date.now() + startOffsetMs);
        const event = await prisma.event.create({
            data: {
                name: `${TAG} ${label}`,
                start,
                end: new Date(start.getTime() + HOUR),
                description: 'reschedule',
                ...(recurringGroupId ? { recurringGroupId } : {}),
            },
        });
        await prisma.rSVP.create({
            data: { eventId: event.id, participantId, status: 'ATTENDING', reminderSentAt: new Date() },
        });
        return event.id;
    }

    function reminderSentAt(eventId: number) {
        return prisma.rSVP
            .findUnique({ where: { eventId_participantId: { eventId, participantId } } })
            .then(r => r?.reminderSentAt ?? null);
    }

    it('clears reminderSentAt when the start moves, and the cron re-notifies', async () => {
        const eventId = await makeEvent('single', 2 * HOUR + 5 * MIN);
        expect(await reminderSentAt(eventId)).not.toBeNull();

        const newStart = new Date(Date.now() + 2 * HOUR + 8 * MIN);
        const res = await patch(eventId, { action: 'editTime', start: newStart.toISOString() });
        expect(res.status).toBe(200);

        expect(await reminderSentAt(eventId)).toBeNull();

        // New start is still inside the [now+2h, now+2h15m] window → cron re-sends once.
        const cron = await cronReminders(cronReq());
        expect(cron.status).toBe(200);
        expect((sendNotification as jest.Mock).mock.calls.length).toBe(1);
        expect(await reminderSentAt(eventId)).not.toBeNull();
    });

    it('does NOT clear reminderSentAt for an end-only edit', async () => {
        const eventId = await makeEvent('end-only', 2 * HOUR + 5 * MIN);
        const before = await reminderSentAt(eventId);
        expect(before).not.toBeNull();

        const newEnd = new Date(Date.now() + 3 * HOUR);
        const res = await patch(eventId, { action: 'editTime', end: newEnd.toISOString() });
        expect(res.status).toBe(200);

        // start unchanged → reminder state preserved.
        expect(await reminderSentAt(eventId)).toEqual(before);
    });

    it('does NOT clear when the supplied start equals the current start', async () => {
        const start = new Date(Date.now() + 2 * HOUR + 5 * MIN);
        const event = await prisma.event.create({
            data: {
                name: `${TAG} same-start`,
                start,
                end: new Date(start.getTime() + HOUR),
                description: 'reschedule',
            },
        });
        await prisma.rSVP.create({
            data: { eventId: event.id, participantId, status: 'ATTENDING', reminderSentAt: new Date() },
        });
        const before = await reminderSentAt(event.id);

        const res = await patch(event.id, { action: 'editTime', start: start.toISOString() });
        expect(res.status).toBe(200);

        expect(await reminderSentAt(event.id)).toEqual(before);
    });

    it('rejects editTime on a past event and leaves reminderSentAt untouched', async () => {
        // Event already finished (started 3h ago, ended 2h ago).
        const start = new Date(Date.now() - 3 * HOUR);
        const event = await prisma.event.create({
            data: {
                name: `${TAG} past`,
                start,
                end: new Date(start.getTime() + HOUR),
                description: 'reschedule',
            },
        });
        await prisma.rSVP.create({
            data: { eventId: event.id, participantId, status: 'ATTENDING', reminderSentAt: new Date() },
        });
        const before = await reminderSentAt(event.id);
        expect(before).not.toBeNull();

        const newStart = new Date(Date.now() + 2 * HOUR);
        const res = await patch(event.id, { action: 'editTime', start: newStart.toISOString() });
        expect(res.status).toBe(400);

        // Reminder state preserved — a finished event's reminder must not be re-armed.
        expect(await reminderSentAt(event.id)).toEqual(before);
    });

    it('clears reminderSentAt across a series when applyToFuture shifts the start', async () => {
        const group = `${TAG}-group`;
        const first = await makeEvent('series-1', 2 * HOUR + 5 * MIN, group);
        const second = await makeEvent('series-2', 26 * HOUR + 5 * MIN, group);

        expect(await reminderSentAt(first)).not.toBeNull();
        expect(await reminderSentAt(second)).not.toBeNull();

        const newStart = new Date(Date.now() + 2 * HOUR + 30 * MIN);
        const res = await patch(first, {
            action: 'editTime',
            start: newStart.toISOString(),
            applyToFuture: true,
        });
        expect(res.status).toBe(200);

        expect(await reminderSentAt(first)).toBeNull();
        expect(await reminderSentAt(second)).toBeNull();
    });
});
