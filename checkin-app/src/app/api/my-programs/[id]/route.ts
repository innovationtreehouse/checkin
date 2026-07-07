import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import {
    summarizeVisits,
    toLeadContact,
    rosterCsv,
    eventsCsv,
    type ProgramInfo,
    type RosterEntry,
    type EventTurnout,
} from "@/lib/programRoster";

export const dynamic = "force-dynamic";

/**
 * GET /api/my-programs/[id] — roster + attendance summary + stats for ONE program
 * the caller leads (board/sysadmin pass through). Backs the staff "My Programs ›
 * Roster" tab and its CSV export (`?format=csv&kind=roster|events`).
 *
 * Scoping IS the security control here: ProgramParticipant/Visit rows are all
 * public-tier, so per-field stripping can't hide the enrollment/attendance fact —
 * only admission can. This handler returns rows ONLY when the caller leads the
 * program (query-shaped by leadMentorId) or is board/sysadmin. Registered in
 * tests/security/routeAuthDrift.test.ts EDGE_INCLUDE_ALLOWLIST.
 *
 * PII discipline: participant rows carry name + status + household-lead contact
 * (email/phone are the contact-identity band leads may already hold). The
 * finance-confidential fields (isPaymentPlanRequested / paymentPlanDeniedAt /
 * inventoryHeldAt) are never selected onto a row — scholarship demand is a COUNT
 * only, no names.
 */
export const GET = withAuth({}, async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    const { id } = await params;
    const programId = parseInt(id, 10);
    if (isNaN(programId)) return apiError("Invalid program ID", 400);

    const program = await prisma.program.findUnique({
        where: { id: programId },
        select: { id: true, name: true, maxParticipants: true, leadMentorId: true },
    });
    if (!program) return apiError("Program not found", 404);

    const isLead = program.leadMentorId === auth.user.id;
    const isBoard = auth.user.isSysadmin || auth.user.isBoardMember;
    if (!isLead && !isBoard) return apiError("Forbidden", 403);

    const [participants, scholarshipRequests, events] = await Promise.all([
        prisma.programParticipant.findMany({
            where: { programId },
            select: {
                personId: true,
                status: true,
                person: {
                    select: {
                        id: true,
                        name: true,
                        household: {
                            select: {
                                householdMembers: {
                                    where: { isHouseholdLead: true },
                                    select: { name: true, email: true, phone: true },
                                },
                            },
                        },
                    },
                },
            },
        }),
        // Finance-confidential: exposed as a bare count, never per-participant.
        prisma.programParticipant.count({ where: { programId, isPaymentPlanRequested: true } }),
        prisma.event.findMany({
            where: { programId },
            select: { id: true, name: true, startAt: true, attendanceConfirmedAt: true },
            orderBy: { startAt: "asc" },
        }),
    ]);

    const eventIds = events.map((e) => e.id);
    const visits = eventIds.length
        ? await prisma.visit.findMany({
              where: { associatedEventId: { in: eventIds } },
              select: { personId: true, associatedEventId: true, arrivedAt: true },
          })
        : [];

    const { eventsByPerson, lastSeenByPerson, peopleByEvent } = summarizeVisits(visits);

    const roster: RosterEntry[] = participants
        .map((p) => ({
            personId: p.personId,
            name: p.person.name ?? "(unnamed)",
            status: p.status,
            contact: toLeadContact(p.person.household.householdMembers),
            attendanceCount: eventsByPerson.get(p.personId)?.size ?? 0,
            lastSeenAt: lastSeenByPerson.get(p.personId)?.toISOString() ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

    const eventTurnout: EventTurnout[] = events.map((e) => ({
        eventId: e.id,
        name: e.name,
        startAt: e.startAt.toISOString(),
        attendanceConfirmedAt: e.attendanceConfirmedAt?.toISOString() ?? null,
        turnout: peopleByEvent.get(e.id)?.size ?? 0,
    }));

    const info: ProgramInfo = {
        program: {
            id: program.id,
            name: program.name,
            enrolled: participants.filter((p) => p.status === "ACTIVE").length,
            pending: participants.filter((p) => p.status === "PENDING").length,
            capacity: program.maxParticipants,
            eventCount: events.length,
            scholarshipRequests,
        },
        roster,
        events: eventTurnout,
    };

    const format = new URL(req.url).searchParams.get("format");
    if (format === "csv") {
        const kind = new URL(req.url).searchParams.get("kind") === "events" ? "events" : "roster";
        const csv = kind === "events" ? eventsCsv(info) : rosterCsv(info);
        // Bare web Response for the CSV body + attachment headers. Valid at runtime
        // (NextResponse extends Response); cast satisfies withAuth's NextResponse type.
        return new Response(csv, {
            status: 200,
            headers: {
                "Content-Type": "text/csv; charset=utf-8",
                "Content-Disposition": `attachment; filename="program-${programId}-${kind}.csv"`,
            },
        }) as unknown as NextResponse;
    }

    return NextResponse.json(info);
});
