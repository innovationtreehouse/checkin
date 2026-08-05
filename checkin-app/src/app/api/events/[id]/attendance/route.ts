import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { LIVE_VISIT } from "@/lib/visit/filters";

export const POST = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return apiError("Unauthorized", 401);
    const { id } = await params;

    try {
        const eventId = parseInt(id, 10);
        if (isNaN(eventId)) {
            return apiError("Invalid event ID", 400);
        }

        const event = await prisma.event.findUnique({
            where: { id: eventId },
            include: { program: true }
        });

        if (!event) {
            return apiError("Event not found", 404);
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = event.program?.leadMentorId === currentUserId;
        const isSysAdminOrBoardOrKeyholder = auth.user.isSysadmin || auth.user.isBoardMember || auth.user.isKeyholder;

        if (!isLeadMentor && !isSysAdminOrBoardOrKeyholder) {
            return apiError("Forbidden: Not authorized to validate attendance", 403);
        }

        const body = await req.json();
        const { participantIds } = body; // Array of participant IDs who actually attended

        if (!Array.isArray(participantIds)) {
            return apiError("participantIds array is required", 400);
        }

        // Authz on the TARGETS: only participants enrolled or volunteering in
        // this event's program may have attendance written. Without this a lead
        // mentor of program A could fabricate presence records for anyone in the
        // system (other households/programs). Enrollment/volunteer membership —
        // not an existing overlapping Visit — is the authority; unknown ids are
        // rejected (a genuine unenrolled walk-in needs a separate manual step).
        // A program-less event is reachable only by admin/board (the lead/core-vol
        // gate above requires a program), so there is no cross-program IDOR there
        // and no enrollment set to check — skip the filter in that case.
        const programId = event.programId;
        if (programId != null) {
            const [enrolled, volunteering] = await Promise.all([
                prisma.programParticipant.findMany({ where: { programId }, select: { personId: true } }),
                prisma.programVolunteer.findMany({ where: { programId }, select: { personId: true } }),
            ]);
            const allowedIds = new Set<number>([...enrolled, ...volunteering].map(r => r.personId));
            const unknownIds = participantIds.filter(pId => !allowedIds.has(pId));
            if (unknownIds.length > 0) {
                return apiError(`Participants not enrolled or volunteering in this program: ${unknownIds.join(", ")}`, 400);
            }
        }

        // Dedupe within the request so a repeated id can't double-write.
        const uniqueParticipantIds = [...new Set<number>(participantIds)];

        const results = await prisma.$transaction(async (tx) => {
            const actions = [];

            // Pre-fetch, for these participants: visits already recorded for THIS
            // event (skip — avoids duplicate synthetic rows on concurrent submits)
            // and overlapping unassociated walk-in visits (adopt into the event).
            const relevantVisits = await tx.visit.findMany({
                where: {
                    personId: { in: uniqueParticipantIds },
                    ...LIVE_VISIT,
                    OR: [
                        { associatedEventId: eventId },
                        {
                            associatedEventId: null,
                            arrivedAt: { lte: event.endAt },
                            OR: [
                                { departedAt: null },
                                { departedAt: { gte: event.startAt } }
                            ]
                        }
                    ]
                }
            });

            // Map by participantId for O(1) lookups.
            const alreadyRecorded = new Set<number>();
            const visitsByParticipant = new Map();
            for (const visit of relevantVisits) {
                if (visit.associatedEventId === eventId) {
                    alreadyRecorded.add(visit.personId);
                } else if (!visitsByParticipant.has(visit.personId)) {
                    // First matching unassociated visit for each participant.
                    visitsByParticipant.set(visit.personId, visit);
                }
            }

            for (const pId of uniqueParticipantIds) {
                // Already attributed to this event → nothing to do (no dup row).
                if (alreadyRecorded.has(pId)) continue;

                const visit = visitsByParticipant.get(pId);

                if (visit) {
                    const updated = await tx.visit.update({
                        where: { id: visit.id },
                        data: { associatedEventId: eventId }
                    });
                    actions.push(updated);
                    // Audit keyed by the actual Visit row, with the SUBJECT in
                    // secondaryAffectedEntity — the one meaning that column carries
                    // on a Visit row, so `actorId === secondaryAffectedEntity` is a
                    // reliable self-vs-proxy test. The event is not lost: it is in
                    // newData.associatedEventId.
                    await tx.auditLog.create({
                        data: {
                            actorId: currentUserId,
                            action: 'EDIT',
                            tableName: 'Visit',
                            affectedEntityId: updated.id,
                            secondaryAffectedEntity: pId,
                            newData: { participantId: pId, associatedEventId: eventId, synthetic: false }
                        }
                    });
                } else {
                    // Create a synthetic visit since they were marked attended but didn't badge in.
                    // LEAD_MARKED on BOTH fields flags this as asserted, not measured: the event
                    // window is a placeholder, not a real badge-in/out duration. It is the unique
                    // marker on *arrivedVia* — real visits only ever use SCANNER/WEB there, and the
                    // machine closers write only departedVia. Building-hours analytics
                    // (facility/trends) exclude arrivedVia=LEAD_MARKED so this placeholder window
                    // isn't counted as real hours. Keep departedAt set (not null): null would mark
                    // it "open", tripping the nightly auto-checkout and the one-open-visit index.
                    const newVisit = await tx.visit.create({
                        data: {
                            personId: pId,
                            associatedEventId: eventId,
                            arrivedAt: event.startAt,
                            departedAt: event.endAt,
                            arrivedVia: "LEAD_MARKED",
                            departedVia: "LEAD_MARKED"
                        }
                    });
                    actions.push(newVisit);
                    await tx.auditLog.create({
                        data: {
                            actorId: currentUserId,
                            action: 'CREATE',
                            tableName: 'Visit',
                            affectedEntityId: newVisit.id,
                            secondaryAffectedEntity: pId,
                            newData: { participantId: pId, associatedEventId: eventId, synthetic: true }
                        }
                    });
                }
            }
            return actions;
        });

        return NextResponse.json({ success: true, processed: results.length });
    } catch (error) {
        logger.error("Attendance validation error:", error);
        return apiError("Failed to validate attendance", 500);
    }
});
