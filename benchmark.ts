import prisma from './src/lib/prisma';
import { performance } from 'perf_hooks';

async function runBenchmark() {
    console.log("Setting up benchmark data...");

    const user = await prisma.participant.create({
        data: {
            email: 'bench@example.com',
            sysadmin: true,
        }
    });

    const program = await prisma.program.create({
        data: {
            name: 'Bench Program',
            enrollmentStatus: 'OPEN',
        }
    });

    const event = await prisma.event.create({
        data: {
            name: 'Bench Event',
            programId: program.id,
            start: new Date(Date.now() - 100000),
            end: new Date(),
        }
    });

    const participants: number[] = [];
    for (let i = 0; i < 200; i++) {
        const p = await prisma.participant.create({
            data: {
                email: `bench${i}@example.com`,
            }
        });
        participants.push(p.id);

        if (i % 2 === 0) {
            await prisma.visit.create({
                data: {
                    participantId: p.id,
                    arrived: new Date(Date.now() - 50000),
                    departed: new Date(Date.now() - 10000),
                }
            });
        }
    }

    console.log(`Created ${participants.length} participants`);

    console.log("Starting benchmark...");

    const start = performance.now();

    const results = await prisma.$transaction(async (tx: any) => {
        const actions = [];
        for (const pId of participants) {
            const visit = await tx.visit.findFirst({
                where: {
                    participantId: pId,
                    associatedEventId: null,
                    arrived: { lte: event.end },
                    OR: [
                        { departed: null },
                        { departed: { gte: event.start } }
                    ]
                }
            });

            if (visit) {
                const updated = await tx.visit.update({
                    where: { id: visit.id },
                    data: { associatedEventId: event.id }
                });
                actions.push(updated);
            } else {
                const newVisit = await tx.visit.create({
                    data: {
                        participantId: pId,
                        associatedEventId: event.id,
                        arrived: event.start,
                        departed: event.end
                    }
                });
                actions.push(newVisit);
            }
        }
        return actions;
    });

    const end = performance.now();
    console.log(`Original logic time: ${end - start} ms for ${results.length} participants`);

    // Add new logic baseline (using batch query)
    console.log("Starting new logic benchmark...");

    // Reset data mapping
    await tx_reset(participants);

    const start2 = performance.now();
    const results2 = await prisma.$transaction(async (tx: any) => {
        const actions = [];
        const visits = await tx.visit.findMany({
            where: {
                participantId: { in: participants },
                associatedEventId: null,
                arrived: { lte: event.end },
                OR: [
                    { departed: null },
                    { departed: { gte: event.start } }
                ]
            }
        });

        const visitMap = new Map();
        for (const v of visits) {
            visitMap.set(v.participantId, v);
        }

        for (const pId of participants) {
            const visit = visitMap.get(pId);
            if (visit) {
                const updated = await tx.visit.update({
                    where: { id: visit.id },
                    data: { associatedEventId: event.id }
                });
                actions.push(updated);
            } else {
                const newVisit = await tx.visit.create({
                    data: {
                        participantId: pId,
                        associatedEventId: event.id,
                        arrived: event.start,
                        departed: event.end
                    }
                });
                actions.push(newVisit);
            }
        }
        return actions;
    });
    const end2 = performance.now();
    console.log(`New logic time: ${end2 - start2} ms for ${results2.length} participants`);


    await prisma.visit.deleteMany({ where: { participantId: { in: participants } }});
    await prisma.participant.deleteMany({ where: { id: { in: participants } }});
    await prisma.event.delete({ where: { id: event.id } });
    await prisma.program.delete({ where: { id: program.id } });
    await prisma.participant.delete({ where: { id: user.id } });

    console.log("Cleanup complete");
}

async function tx_reset(participants: number[]) {
   // reset all event associations for test
   await prisma.visit.deleteMany({ where: { participantId: { in: participants }, associatedEventId: { not: null } }});
   for (let i = 0; i < participants.length; i++) {
        if (i % 2 === 0) {
            await prisma.visit.create({
                data: {
                    participantId: participants[i],
                    arrived: new Date(Date.now() - 50000),
                    departed: new Date(Date.now() - 10000),
                }
            });
        }
    }
}

runBenchmark().catch(console.error).finally(() => prisma.$disconnect());
