import { processPostEventEmails } from '../postEventEmails';
import prisma from '../prisma';

jest.mock('../email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

describe('Performance benchmark for processPostEventEmails', () => {
    let origFindMany: any;
    let origFindUnique: any;
    let origParticipantFindMany: any;
    let origEventUpdate: any;

    beforeAll(() => {
        origFindMany = prisma.event.findMany;
        origFindUnique = prisma.participant.findUnique;
        origParticipantFindMany = prisma.participant.findMany;
        origEventUpdate = prisma.event.update;
    });

    afterAll(() => {
        prisma.event.findMany = origFindMany;
        prisma.participant.findUnique = origFindUnique;
        prisma.participant.findMany = origParticipantFindMany;
        prisma.event.update = origEventUpdate;
    });

    it('benchmarks processPostEventEmails', async () => {
        const numEvents = 500;
        const mockEvents = Array.from({ length: numEvents }).map((_, i) => ({
            id: i + 1,
            name: `Event ${i + 1}`,
            program: {
                id: i + 1,
                leadMentorId: i + 1,
                volunteers: []
            },
            rsvps: [],
            visits: []
        }));

        let callCount = 0;
        prisma.event.findMany = jest.fn().mockImplementation(async () => {
            if (callCount === 0) {
                callCount++;
                return mockEvents as any;
            }
            return [];
        });

        prisma.event.update = jest.fn().mockImplementation(async () => { return {} as any; });

        let uniqueCalls = 0;
        prisma.participant.findUnique = jest.fn().mockImplementation(async ({ where }: any) => {
            uniqueCalls++;
            await new Promise(resolve => setTimeout(resolve, 5));
            return { email: `lead${where.id}@example.com` } as any;
        });

        let manyCalls = 0;
        prisma.participant.findMany = jest.fn().mockImplementation(async ({ where }: any) => {
            manyCalls++;
            await new Promise(resolve => setTimeout(resolve, 10));
            const ids = where.id.in as number[];
            return ids.map(id => ({ id, email: `lead${id}@example.com` })) as any;
        });

        console.log(`Starting benchmark for ${numEvents} events...`);
        const start = Date.now();
        await processPostEventEmails({ forceImmediate: true, batchSize: numEvents });
        const end = Date.now();

        console.log(`Time taken: ${end - start}ms`);
        console.log(`findUnique calls: ${uniqueCalls}`);
        console.log(`findMany calls: ${manyCalls}`);

        expect(uniqueCalls).toBe(0);
        expect(manyCalls).toBe(1);
    });
});
