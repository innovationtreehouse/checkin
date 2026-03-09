import prisma from '../src/lib/prisma';

// The amount of hours to shift the events forward. 
// 18:00 UTC showing as 13:00 (1PM) needs +5 hours to become 23:00 UTC (18:00 / 6PM in CDT).
const SHIFT_HOURS = 5;

async function main() {
    console.log(`Starting timezone migration: Shifting all events forward by ${SHIFT_HOURS} hours...`);

    const events = await prisma.event.findMany();
    
    if (events.length === 0) {
        console.log("No events found in the database. Exiting.");
        return;
    }

    let updatedCount = 0;

    for (const event of events) {
        // Add 5 hours to both start and end timestamps
        const newStart = new Date(event.start.getTime() + SHIFT_HOURS * 60 * 60 * 1000);
        const newEnd = new Date(event.end.getTime() + SHIFT_HOURS * 60 * 60 * 1000);

        await prisma.event.update({
            where: { id: event.id },
            data: {
                start: newStart,
                end: newEnd
            }
        });

        updatedCount++;
        console.log(`Updated Event ID ${event.id}: '${event.name}'`);
        console.log(`  Start: ${event.start.toISOString()} -> ${newStart.toISOString()}`);
        console.log(`  End:   ${event.end.toISOString()} -> ${newEnd.toISOString()}`);
    }

    console.log(`\nSuccessfully shifted ${updatedCount} events!`);
}

main()
    .catch((e) => {
        console.error("Migration failed:", e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
