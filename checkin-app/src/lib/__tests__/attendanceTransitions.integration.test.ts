/**
 * @jest-environment node
 */
/**
 * Integration tests for attendanceTransitions.ts — the visit-chunking state
 * machine that splits one open visit into multiple event-associated + gap
 * visits inside a $transaction. The scan tests only ever hit the no-events
 * path; the interesting boundary math (gap-before, back-to-back events,
 * already-closed/missing visits) was untested.
 */
import { findAssociatedEventAt, processVisitCheckout } from '@/lib/attendanceTransitions';
import prisma from '@/lib/prisma';

const TAG = 'attendance-transitions-test';
const HOUR = 60 * 60 * 1000;

describe('attendanceTransitions', () => {
    let programId: number;
    let participantId: number;
    let unenrolledId: number;
    const householdIds: number[] = [];

    beforeAll(async () => {
        const program = await prisma.program.create({
            data: { name: `AT Program ${TAG}`, enrollmentStatus: 'OPEN' },
        });
        programId = program.id;

        const p = await prisma.participant.create({
            data: { name: 'AT Enrolled', email: `enrolled-${TAG}@example.com`, household: { create: {} } },
        });
        participantId = p.id;
        householdIds.push(p.householdId);
        await prisma.programParticipant.create({
            data: { programId, participantId, status: 'ACTIVE', pendingSince: null },
        });

        const u = await prisma.participant.create({
            data: { name: 'AT Unenrolled', email: `unenrolled-${TAG}@example.com`, household: { create: {} } },
        });
        unenrolledId = u.id;
        householdIds.push(u.householdId);
    });

    afterEach(async () => {
        await prisma.visit.deleteMany({ where: { participantId: { in: [participantId, unenrolledId] } } });
        await prisma.event.deleteMany({ where: { name: { contains: TAG } } });
    });

    afterAll(async () => {
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.program.delete({ where: { id: programId } });
        await prisma.participant.deleteMany({ where: { id: { in: [participantId, unenrolledId] } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    function makeEvent(label: string, start: Date, end: Date) {
        return prisma.event.create({
            data: { name: `${TAG} ${label}`, programId, start, end, description: 'x' },
        });
    }

    describe('findAssociatedEventAt', () => {
        it('returns null for a participant enrolled in no programs', async () => {
            const id = await findAssociatedEventAt(unenrolledId, new Date());
            expect(id).toBeNull();
        });

        it('matches an event that is currently ongoing', async () => {
            const now = new Date();
            const ev = await makeEvent('ongoing', new Date(now.getTime() - HOUR), new Date(now.getTime() + HOUR));
            const id = await findAssociatedEventAt(participantId, now);
            expect(id).toBe(ev.id);
        });

        it('matches an event starting within the next 4 hours', async () => {
            const now = new Date();
            const ev = await makeEvent('soon', new Date(now.getTime() + 3 * HOUR), new Date(now.getTime() + 4 * HOUR));
            const id = await findAssociatedEventAt(participantId, now);
            expect(id).toBe(ev.id);
        });

        it('does NOT match an event starting more than 4 hours out', async () => {
            const now = new Date();
            await makeEvent('far', new Date(now.getTime() + 5 * HOUR), new Date(now.getTime() + 6 * HOUR));
            const id = await findAssociatedEventAt(participantId, now);
            expect(id).toBeNull();
        });

        it('returns the soonest of several matching events', async () => {
            const now = new Date();
            const soon = await makeEvent('a-soon', new Date(now.getTime() + HOUR), new Date(now.getTime() + 2 * HOUR));
            await makeEvent('b-later', new Date(now.getTime() + 3 * HOUR), new Date(now.getTime() + 4 * HOUR));
            const id = await findAssociatedEventAt(participantId, now);
            expect(id).toBe(soon.id);
        });
    });

    describe('processVisitCheckout', () => {
        it('closes a plain visit with no events into a single departedAt visit', async () => {
            const arrivedAt = new Date(Date.now() - 2 * HOUR);
            const checkout = new Date();
            const visit = await prisma.visit.create({ data: { participantId, arrivedAt } });

            const result = await processVisitCheckout(visit.id, checkout);
            expect(result).toHaveLength(1);
            expect(result[0].departedAt).toEqual(checkout);
            expect(result[0].associatedEventId).toBeNull();
        });

        it('chunks a stay around one mid-stay event into a gap visit + an event visit', async () => {
            const t0 = new Date(Date.now() - 4 * HOUR);
            const eventStart = new Date(t0.getTime() + HOUR);
            const eventEnd = new Date(t0.getTime() + 2 * HOUR);
            const checkout = new Date(t0.getTime() + 3 * HOUR);
            const ev = await makeEvent('mid', eventStart, eventEnd);
            const visit = await prisma.visit.create({ data: { participantId, arrivedAt: t0 } });

            const result = await processVisitCheckout(visit.id, checkout);

            // Original open visit is replaced by the chunks.
            const original = await prisma.visit.findUnique({ where: { id: visit.id } });
            expect(original).toBeNull();

            const gap = result.find(v => v.associatedEventId === null);
            const eventVisit = result.find(v => v.associatedEventId === ev.id);
            expect(gap).toBeDefined();
            expect(eventVisit).toBeDefined();
            // Gap covers arrival → event start; event visit covers event start → checkout.
            expect(gap!.arrivedAt).toEqual(t0);
            expect(gap!.departedAt).toEqual(eventStart);
            expect(eventVisit!.arrivedAt).toEqual(eventStart);
            expect(eventVisit!.departedAt).toEqual(checkout);
        });

        it('splits back-to-back events into adjacent event visits at the handoff', async () => {
            const t0 = new Date(Date.now() - 5 * HOUR);
            const e1Start = new Date(t0.getTime() + HOUR);
            const e1End = new Date(t0.getTime() + 2 * HOUR);
            const e2Start = new Date(t0.getTime() + 2 * HOUR);
            const e2End = new Date(t0.getTime() + 3 * HOUR);
            const checkout = new Date(t0.getTime() + 4 * HOUR);
            const e1 = await makeEvent('back1', e1Start, e1End);
            const e2 = await makeEvent('back2', e2Start, e2End);
            const visit = await prisma.visit.create({ data: { participantId, arrivedAt: t0 } });

            const result = await processVisitCheckout(visit.id, checkout);

            const v1 = result.find(v => v.associatedEventId === e1.id);
            const v2 = result.find(v => v.associatedEventId === e2.id);
            expect(v1).toBeDefined();
            expect(v2).toBeDefined();
            // Handoff: e1 visit ends exactly where e2 visit begins.
            expect(v1!.departedAt).toEqual(e2Start);
            expect(v2!.arrivedAt).toEqual(e2Start);
            expect(v2!.departedAt).toEqual(checkout);
        });

        it('returns [] for an already-departedAt visit (idempotent)', async () => {
            const visit = await prisma.visit.create({
                data: { participantId, arrivedAt: new Date(Date.now() - HOUR), departedAt: new Date() },
            });
            const result = await processVisitCheckout(visit.id, new Date());
            expect(result).toEqual([]);
        });

        it('returns [] for a non-existent visit id', async () => {
            const result = await processVisitCheckout(99999999, new Date());
            expect(result).toEqual([]);
        });
    });
});
