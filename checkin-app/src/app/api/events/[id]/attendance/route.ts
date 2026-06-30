import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const POST = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    try {
        const eventId = parseInt(id, 10);
        if (isNaN(eventId)) {
            return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
        }

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { program: true }
        });

        if (!event) {
            return NextResponse.json({ error: "Event not found" }, { status: 404 });
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = event.program?.leadMentorId === currentUserId;
        const isSysAdminOrBoardOrKeyholder = auth.user.isSysadmin || auth.user.isBoardMember || auth.user.isKeyholder;

        if (!isLeadMentor && !isSysAdminOrBoardOrKeyholder) {
            return NextResponse.json({ error: "Forbidden: Not authorized to validate attendance" }, { status: 403 });
        }

        const body = await req.json();
        const { participantIds } = body; // Array of participant IDs who actually attended

        if (!Array.isArray(participantIds)) {
            return NextResponse.json({ error: "participantIds array is required" }, { status: 400 });
        }

        const results = await prisma.$transaction(async (tx) => {
            const actions = [];

            // Pre-fetch all overlapping unassociated visits for the participants
            const overlappingVisits = await tx.visit.findMany({
                where: {
                    participantId: { in: participantIds },
                    associatedEventId: null,
                    arrivedAt: { lte: event.endAt },
                    OR: [
                        { departedAt: null },
                        { departedAt: { gte: event.startAt } }
                    ]
                }
            });

            // Map them by participantId for O(1) lookups
            const visitsByParticipant = new Map();
            for (const visit of overlappingVisits) {
                // We just need the first matching unassociated visit for each participant.
                if (!visitsByParticipant.has(visit.participantId)) {
                    visitsByParticipant.set(visit.participantId, visit);
                }
            }

            for (const pId of participantIds) {
                const visit = visitsByParticipant.get(pId);

                if (visit) {
                    const updated = await tx.visit.update({
                        where: { id: visit.id },
                        data: { associatedEventId: eventId }
                    });
                    actions.push(updated);
                    // Audit keyed by the actual Visit row (secondary = event), so a
                    // suspect visit is reverse-lookupable by its own PK.
                    await tx.auditLog.create({
                        data: {
                            actorId: currentUserId,
                            action: 'EDIT',
                            tableName: 'Visit',
                            affectedEntityId: updated.id,
                            secondaryAffectedEntity: eventId,
                            newData: JSON.stringify({ participantId: pId, associatedEventId: eventId, synthetic: false })
                        }
                    });
                } else {
                    // Create a synthetic visit since they were marked attended but didn't badge in.
                    // arrivedVia/departedVia = SYSTEM flags this as fabricated, not measured: the
                    // event window is a placeholder, not a real badge-in/out duration. SYSTEM on
                    // *arrivedVia* is the unique marker — real visits only ever use SCANNER/WEB there
                    // (cron uses SYSTEM only on departedVia). Building-hours analytics (facility/trends)
                    // exclude arrivedVia=SYSTEM so this placeholder window isn't counted as real hours.
                    // Keep departedAt set (not null): null would mark it "open", tripping the nightly
                    // auto-checkout and the one-open-visit-per-participant index.
                    const newVisit = await tx.visit.create({
                        data: {
                            participantId: pId,
                            associatedEventId: eventId,
                            arrivedAt: event.startAt,
                            departedAt: event.endAt,
                            arrivedVia: "SYSTEM",
                            departedVia: "SYSTEM"
                        }
                    });
                    actions.push(newVisit);
                    await tx.auditLog.create({
                        data: {
                            actorId: currentUserId,
                            action: 'CREATE',
                            tableName: 'Visit',
                            affectedEntityId: newVisit.id,
                            secondaryAffectedEntity: eventId,
                            newData: JSON.stringify({ participantId: pId, associatedEventId: eventId, synthetic: true })
                        }
                    });
                }
            }
            return actions;
        });

        return NextResponse.json({ success: true, processed: results.length });
    } catch (error) {
        console.error("Attendance validation error:", error);
        return NextResponse.json({ error: "Failed to validate attendance" }, { status: 500 });
    }
});
