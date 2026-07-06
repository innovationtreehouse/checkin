/**
 * @jest-environment node
 */
/**
 * Edge-case integration tests for GET /api/cron/reminders.
 *
 * The existing cronRemindersAPI test only covers the happy path with a valid
 * secret and a single in-window event. These add:
 *   - window selection at the inside/outside boundaries of the [now+2h, +2h15m] range
 *   - idempotency: a second run does NOT re-send, because the route now stamps
 *     RSVP.reminderSentAt after sending and excludes already-reminded RSVPs.
 */
import { GET } from '@/app/api/cron/reminders/route';
import prisma from '@/lib/prisma';
import { sendNotification } from '@/lib/notifications';

jest.mock('@/lib/notifications', () => ({
    // Resolves true (the real signature is Promise<boolean>); the route stamps
    // reminderSentAt only on a truthy result, which is what makes the second run idempotent.
    sendNotification: jest.fn().mockResolvedValue(true),
}));

const SECRET = 'reminders-edge-secret';
const TAG = 'reminders-edge-test';
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

function cronReq(authHeader?: string) {
    const headers: Record<string, string> = {};
    if (authHeader) headers['authorization'] = authHeader;
    return new Request('http://localhost/api/cron/reminders', {
        method: 'GET',
        headers,
    }) as unknown as import('next/server').NextRequest;
}

describe('GET /api/cron/reminders — auth & window edges', () => {
    let participantId: number;
    let householdId: number;

    beforeAll(async () => {
        const p = await prisma.person.create({
            data: { name: 'Reminders Edge', email: `p-${TAG}@example.com`, household: { create: { name: "Test HH" } } },
        });
        participantId = p.id;
        householdId = p.householdId;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CRON_SECRET = SECRET;
    });

    afterEach(async () => {
        await prisma.rSVP.deleteMany({ where: { personId: participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
    });

    afterAll(async () => {
        await prisma.rSVP.deleteMany({ where: { personId: participantId } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.person.deleteMany({ where: { id: participantId } });
        await prisma.household.deleteMany({ where: { id: householdId } });
    });

    async function makeEvent(label: string, startOffsetMs: number) {
        const start = new Date(Date.now() + startOffsetMs);
        const event = await prisma.event.create({
            data: {
                name: `${TAG} ${label}`,
                startAt: start,
                endAt: new Date(start.getTime() + HOUR),
                description: 'edge',
            },
        });
        await prisma.rSVP.create({
            data: { eventId: event.id, personId: participantId, status: 'ATTENDING' },
        });
        return event.id;
    }

    // Cron auth (missing / wrong / unconfigured secret) is covered centrally in
    // src/lib/__tests__/cronAuth.test.ts; this file only exercises the route's
    // window-selection and idempotency edges.

    it('selects only events inside the [now+2h, now+2h15m] window', async () => {
        await makeEvent('inside-early', 2 * HOUR + 1 * MIN);   // just inside lower bound
        await makeEvent('inside-late', 2 * HOUR + 14 * MIN);   // just inside upper bound
        await makeEvent('too-soon', 2 * HOUR - 5 * MIN);       // before the window
        await makeEvent('too-late', 2 * HOUR + 20 * MIN);      // after the window

        const res = await GET(cronReq(`Bearer ${SECRET}`));
        expect(res.status).toBe(200);

        const notified = (sendNotification as jest.Mock).mock.calls.map(c => c[2].eventName);
        expect(notified).toContain(`${TAG} inside-early`);
        expect(notified).toContain(`${TAG} inside-late`);
        expect(notified).not.toContain(`${TAG} too-soon`);
        expect(notified).not.toContain(`${TAG} too-late`);
    });

    it('is idempotent: a second run does not re-send the reminder', async () => {
        await makeEvent('dup', 2 * HOUR + 5 * MIN);

        const first = await GET(cronReq(`Bearer ${SECRET}`));
        expect(first.status).toBe(200);
        const afterFirst = (sendNotification as jest.Mock).mock.calls.length;
        expect(afterFirst).toBe(1);

        const second = await GET(cronReq(`Bearer ${SECRET}`));
        expect(second.status).toBe(200);
        const afterSecond = (sendNotification as jest.Mock).mock.calls.length;

        // reminderSentAt is stamped after the first send and excludes the RSVP
        // from the query, so the overlapping second run is a no-op.
        expect(afterSecond).toBe(1);
    });
});
