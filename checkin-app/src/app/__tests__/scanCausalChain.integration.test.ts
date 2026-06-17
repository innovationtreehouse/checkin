/**
 * @jest-environment node
 */
/**
 * Causal-chain coverage for the last-keyholder checkout: check-in → facility
 * close → post-event emails, plus the "others are still here" warning branch.
 * Previously post-event emails were only tested in isolation with a hand-seeded
 * visit; the trigger from an actual checkout was never exercised.
 */
import { POST } from '@/app/api/scan/route';
import { processCheckout } from '@/lib/scan-service';
import prisma from '@/lib/prisma';
import { authenticateRequest } from '@/lib/auth';
import { processPostEventEmails } from '@/lib/postEventEmails';
import type { Participant } from '@/generated/prisma/client';

jest.mock('@/lib/auth', () => ({ authenticateRequest: jest.fn() }));
jest.mock('@/lib/notifications', () => ({
    sendCheckinNotifications: jest.fn().mockResolvedValue(undefined),
    sendNotification: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/postEventEmails', () => ({
    processPostEventEmails: jest.fn().mockResolvedValue({ processed: 0 }),
}));
jest.mock('@/lib/logger', () => ({
    logBackendError: jest.fn(),
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const TAG = 'scan-causal-test';
const flush = () => new Promise(r => setImmediate(r));

function scanReq(participantId: number) {
    return new Request('http://localhost/api/scan', {
        method: 'POST',
        body: JSON.stringify({ participantId }),
    }) as unknown as import('next/server').NextRequest;
}

describe('Scan causal chain — last keyholder closes facility', () => {
    let keyholder: Participant;
    let normal: Participant;
    const householdIds: number[] = [];

    beforeAll(async () => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'kiosk' });
        keyholder = await prisma.participant.create({
            data: { name: 'Causal Key', email: `key-${TAG}@example.com`, keyholder: true, household: { create: {} } },
        });
        householdIds.push(keyholder.householdId);
        normal = await prisma.participant.create({
            data: { name: 'Causal Normal', email: `normal-${TAG}@example.com`, household: { create: {} } },
        });
        householdIds.push(normal.householdId);
    });

    beforeEach(() => {
        (authenticateRequest as jest.Mock).mockResolvedValue({ type: 'kiosk' });
        (processPostEventEmails as jest.Mock).mockClear();
    });

    afterEach(async () => {
        await prisma.visit.deleteMany({ where: { participantId: { in: [keyholder.id, normal.id] } } });
        await prisma.rawBadgeEvent.deleteMany({ where: { participantId: { in: [keyholder.id, normal.id] } } });
    });

    afterAll(async () => {
        await prisma.participant.deleteMany({ where: { id: { in: [keyholder.id, normal.id] } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    it('via the scan route: a lone keyholder checking out closes the facility and triggers post-event emails', async () => {
        // Check in.
        const inRes = await POST(scanReq(keyholder.id));
        expect((await inRes.json()).type).toBe('checkin');

        // Past the debounce window.
        await prisma.rawBadgeEvent.updateMany({
            where: { participantId: keyholder.id },
            data: { time: new Date(Date.now() - 5000) },
        });

        // Check out → last keyholder, nobody else present → facility closes.
        const outRes = await POST(scanReq(keyholder.id));
        expect(outRes.status).toBe(200);
        const json = await outRes.json();
        expect(json.type).toBe('checkout');
        expect(json.facilityClosed).toBe(true);

        await flush(); // let the fire-and-forget dynamic import resolve
        expect(processPostEventEmails).toHaveBeenCalledWith({ forceImmediate: true });

        const open = await prisma.visit.count({ where: { participantId: keyholder.id, departed: null } });
        expect(open).toBe(0);
    });

    it('force-closes (departing everyone) when a recent double-badge confirms, then sends post-event emails', async () => {
        const kVisit = await prisma.visit.create({ data: { participantId: keyholder.id, arrived: new Date() } });
        await prisma.visit.create({ data: { participantId: normal.id, arrived: new Date() } });
        // Two keyholder badge events 5s apart (<=12s) → confirmed force-close.
        await prisma.rawBadgeEvent.create({ data: { participantId: keyholder.id, time: new Date(Date.now() - 5000) } });
        await prisma.rawBadgeEvent.create({ data: { participantId: keyholder.id, time: new Date() } });

        const res = await processCheckout(keyholder, kVisit.id, 'kiosk');
        const json = await res.json();
        expect(json.facilityClosed).toBe(true);

        await flush();
        expect(processPostEventEmails).toHaveBeenCalledWith({ forceImmediate: true });

        // Everyone is departed, including the other attendee.
        const openAnyone = await prisma.visit.count({
            where: { participantId: { in: [keyholder.id, normal.id] }, departed: null },
        });
        expect(openAnyone).toBe(0);
    });

    it('warns instead of closing when others are present and there is no recent double-badge', async () => {
        const kVisit = await prisma.visit.create({ data: { participantId: keyholder.id, arrived: new Date() } });
        await prisma.visit.create({ data: { participantId: normal.id, arrived: new Date() } });

        const res = await processCheckout(keyholder, kVisit.id, 'kiosk');
        expect(res.status).toBe(400);
        const json = await res.json();
        expect(json.type).toBe('warning');

        // Nothing closed: both visits remain open and no emails fired.
        const open = await prisma.visit.count({
            where: { participantId: { in: [keyholder.id, normal.id] }, departed: null },
        });
        expect(open).toBe(2);
        expect(processPostEventEmails).not.toHaveBeenCalled();
    });
});
