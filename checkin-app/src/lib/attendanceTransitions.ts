import prisma from "@/lib/prisma";

/**
 * Finds all program IDs that a participant is associated with
 * (as enrolled participant, volunteer, or lead mentor).
 * Uses Promise.all for parallel queries.
 */
async function getRelevantProgramIds(participantId: number): Promise<number[]> {
    const [participantPrograms, volunteerPrograms, leadPrograms] = await Promise.all([
        prisma.programParticipant.findMany({
            where: { participantId },
            select: { programId: true }
        }),
        prisma.programVolunteer.findMany({
            where: { participantId },
            select: { programId: true }
        }),
        prisma.program.findMany({
            where: { leadMentorId: participantId },
            select: { id: true }
        }),
    ]);

    return [
        ...participantPrograms.map(p => p.programId),
        ...volunteerPrograms.map(v => v.programId),
        ...leadPrograms.map(p => p.id)
    ];
}

/**
 * Finds the most relevant event for a participant at a given time.
 * Logic:
 * 1. Checks what programs the participant is enrolled in (or volunteering for).
 * 2. Looks for an event in those programs that is currently ongoing or starting within 4 hours.
 */
export async function findAssociatedEventAt(participantId: number, targetTime: Date): Promise<number | null> {
    // A target event can be one that is currently ongoing OR starting within 4 hours of targetTime
    const timePlus4Hours = new Date(targetTime.getTime() + 4 * 60 * 60 * 1000);

    const relevantProgramIds = await getRelevantProgramIds(participantId);

    if (relevantProgramIds.length === 0) {
        return null;
    }

    // Find the soonest matching event in these programs
    const matchingEvent = await prisma.event.findFirst({
        where: {
            programId: { in: relevantProgramIds },
            // Event must either overlap with targetTime, or start within 4 hours of targetTime
            OR: [
                // Ongoing: start <= targetTime <= end
                {
                    start: { lte: targetTime },
                    end: { gte: targetTime }
                },
                // Upcoming: targetTime < start <= targetTime + 4h
                {
                    start: {
                        gt: targetTime,
                        lte: timePlus4Hours
                    }
                }
            ]
        },
        orderBy: { start: 'asc' }
    });

    return matchingEvent ? matchingEvent.id : null;
}

/**
 * Processes a checkout. It takes an open visit and a checkout time, and creates multiple
 * visits if the user was enrolled in back-to-back events during their stay.
 * 
 * It returns the final list of visits spanning their arrival to departure.
 */
export async function processVisitCheckout(visitId: number, checkoutTime: Date) {
    const originalVisit = await prisma.visit.findUnique({
        where: { id: visitId }
    });

    if (!originalVisit || originalVisit.departed) {
        return []; // Already checked out or doesn't exist
    }

    const { participantId, arrived } = originalVisit;

    const relevantProgramIds = await getRelevantProgramIds(participantId);

    if (relevantProgramIds.length === 0) {
        // No programs enrolled, just close the visit normally
        return [await prisma.visit.update({
            where: { id: visitId },
            data: { departed: checkoutTime }
        })];
    }

    // Find all events in these programs that fall between arrival and checkoutTime
    const eventsDuringStay = await prisma.event.findMany({
        where: {
            programId: { in: relevantProgramIds },
            // An event overlaps if it starts before checkout time AND ends after arrival time
            start: { lt: checkoutTime },
            end: { gt: arrived }
        },
        orderBy: { start: 'asc' }
    });

    if (eventsDuringStay.length === 0) {
        // No relevant events during their stay, just close normally
        return [await prisma.visit.update({
            where: { id: visitId },
            data: { departed: checkoutTime }
        })];
    }

    // We have at least one event. We need to chunk the visit.
    // We will delete the original visit and recreate the chunks inside a transaction.
    return await prisma.$transaction(async (tx) => {
        // First, delete the original open visit
        await tx.visit.delete({
            where: { id: visitId }
        });

        const createdVisits = [];
        let currentIterStart = arrived;

        for (let i = 0; i < eventsDuringStay.length; i++) {
            const event = eventsDuringStay[i];
            const nextEvent = eventsDuringStay[i + 1];

            // If there's a gap between current time and the event start time,
            // create an unassociated visit for the gap time
            if (currentIterStart < event.start) {
                const gapEnd = event.start < checkoutTime ? event.start : checkoutTime;
                if (currentIterStart < gapEnd) {
                    createdVisits.push(await tx.visit.create({
                        data: {
                            participantId,
                            arrived: currentIterStart,
                            departed: gapEnd,
                            associatedEventId: null
                        }
                    }));
                }
                currentIterStart = gapEnd;
            }

            // If we've reached checkout time before the event logic starts, break.
            if (currentIterStart >= checkoutTime) {
                break;
            }

            // Create visit associated with the event
            // The boundaries are constrained by arrival, checkout, and event boundaries
            const eventVisitStart = currentIterStart > event.start ? currentIterStart : event.start;
            
            // Check out when the next event starts, or when they physically leave
            let eventVisitEnd = checkoutTime;
            if (nextEvent && nextEvent.start < checkoutTime) {
                eventVisitEnd = nextEvent.start;
            }

            if (eventVisitStart < eventVisitEnd) {
                createdVisits.push(await tx.visit.create({
                    data: {
                        participantId,
                        arrived: eventVisitStart,
                        departed: eventVisitEnd,
                        associatedEventId: event.id
                    }
                }));
            }
            currentIterStart = eventVisitEnd;
        }

        // If there is still remaining time after the last event until checkOut time, create one last unassociated visit
        if (currentIterStart < checkoutTime) {
            createdVisits.push(await tx.visit.create({
                data: {
                    participantId,
                    arrived: currentIterStart,
                    departed: checkoutTime,
                    associatedEventId: null
                }
            }));
        }

        return createdVisits;
    });
}
