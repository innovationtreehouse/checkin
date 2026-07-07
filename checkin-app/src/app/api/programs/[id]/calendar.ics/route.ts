import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { isActiveOrgMember } from "@/lib/orgMembership";
import { buildIcs, type CalendarEvent } from "@/lib/calendar/ics";

// A program's event schedule as a downloadable .ics (RFC 5545). The auth posture
// MIRRORS GET /api/programs/[id]'s VISIBILITY gate: any signed-in user who can
// see the program can export its schedule. The event fields emitted
// (name/start/end/description) are all @sensitivity:public — the exact fields that
// route already hands to `anyone`. This reads ONLY Event + Program scalar columns
// (no ProgramParticipant/Volunteer/RSVP/Visit), so there is no roster to leak and
// it stays OFF routeAuthDrift's EDGE_INCLUDE_ALLOWLIST by construction.
export const GET = withAuth<{ params: Promise<{ id: string }> }>({}, async (req, auth, { params }) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);

    const { id } = await params;
    const programId = parseInt(id, 10);
    if (isNaN(programId)) return apiError("Invalid program ID", 400);

    const program = await prisma.program.findUnique({
        where: { id: programId },
        select: {
            id: true,
            name: true,
            orgMemberOnly: true,
            leadMentorId: true,
            events: {
                orderBy: { startAt: "asc" },
                select: { id: true, name: true, startAt: true, endAt: true, description: true },
            },
        },
    });
    if (!program) return apiError("Program not found", 404);

    // Member-only visibility gate — mirrors GET /api/programs/[id]: a signed-in
    // non-member who isn't the lead/admin/board can't see a member-only program,
    // so they can't export it either. We omit that route's core-VOLUNTEER branch
    // on purpose: resolving it means reading ProgramVolunteer (an edge model),
    // which would force an EDGE_INCLUDE_ALLOWLIST entry. A core volunteer who is
    // not also a member is rare and still has the per-event Google links / an
    // admin's copy — an acceptable trade for keeping this route roster-free.
    const user = auth.user;
    const isPrivileged = !!(user.isSysadmin || user.isBoardMember || user.id === program.leadMentorId);
    if (program.orgMemberOnly && !isPrivileged && !(await isActiveOrgMember(user.id))) {
        return apiError("Forbidden: Member-Only Program", 403);
    }

    // UID stable per (event id, host): the same real event keeps one UID so a
    // re-download UPDATES the calendar entry instead of duplicating it.
    const host = new URL(req.url).host;
    const calEvents: CalendarEvent[] = program.events.map((ev) => ({
        uid: `program-event-${ev.id}@${host}`,
        start: ev.startAt,
        end: ev.endAt,
        summary: ev.name,
        description: ev.description,
        // Event has no location column; buildIcs emits LOCATION if one ever appears.
    }));

    const ics = buildIcs(calEvents, { prodId: "-//Treehouse//Checkin Program Calendar//EN" });

    // Raw body → a plain Response (App Router accepts one), same as the scan route.
    // withAuth types the handler's return as NextResponse (a Response subtype), so
    // the downcast is just to satisfy that signature; nothing NextResponse-specific
    // is used. apiError() above still returns NextResponse.json for the error paths.
    return new Response(ics, {
        status: 200,
        headers: {
            "Content-Type": "text/calendar; charset=utf-8",
            "Content-Disposition": `attachment; filename="program-${program.id}.ics"`,
            "Cache-Control": "no-store",
        },
    }) as NextResponse;
});
