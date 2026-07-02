import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { handler, notFound, forbidden, badRequest } from "@/security/handler";
import { isActiveOrgMember } from "@/lib/orgMembership";
import { dollarsToCentsOrNull } from "@inventory/money";

export const GET = handler<{ id: string }>('GET /api/programs/[id]', async ({ auth, params }) => {
    const programId = parseInt(params.id, 10);
    if (isNaN(programId)) throw badRequest('Invalid program ID');

    const program = await prisma.program.findUnique({
        where: { id: programId },
        include: {
            volunteers: { include: { person: true } },
            participants: {
                include: {
                    person: {
                        include: {
                            household: {
                                include: {
                                    emergencyContacts: {
                                        where: { conflictParticipantId: null, name: { not: "" }, phone: { not: "" } },
                                        orderBy: [{ priority: "asc" }, { id: "asc" }],
                                        // householdId is the EmergencyContact ROW_SCOPE_KEY: without it
                                        // scopesHeld() fails closed (empty scope set) and the stripper drops
                                        // name/phone/relationship for EVERY viewer, incl. admin/board.
                                        select: { id: true, householdId: true, name: true, phone: true, relationship: true },
                                    },
                                },
                            },
                        },
                    },
                },
            },
            events: { orderBy: { startAt: 'asc' } },
            fees: true,
            leadMentor: true,
            _count: { select: { participants: true, volunteers: true } },
        },
    });

    if (!program) throw notFound('Program not found');

    const isSessionUser = auth.type === 'session';
    const sessionUser = isSessionUser ? auth.user : undefined;
    const isSysAdminOrBoard = !!(sessionUser?.isSysadmin || sessionUser?.isBoardMember);
    const isLeadMentor = !!sessionUser && sessionUser.id === program.leadMentorId;
    const isCoreVolunteer = !!sessionUser && program.volunteers.some(v => v.personId === sessionUser.id && v.isCore);
    const isPrivileged = isSysAdminOrBoard || isLeadMentor || isCoreVolunteer;

    if (program.orgMemberOnly && !isPrivileged) {
        if (!sessionUser) throw notFound('Program not found');
        const hasActiveMembership = await isActiveOrgMember(sessionUser.id);
        if (!hasActiveMembership) throw forbidden('Forbidden: Member-Only Program');
    }

    // ── Association gate (deliberate inline exception) ──────────────────────────
    // The participant/volunteer ROSTER reveals who is enrolled in this program.
    // Each ProgramParticipant/ProgramVolunteer row AND Participant.name are tier
    // 'public', so the handler's per-field stripper CANNOT hide the association:
    // the existence of the row + the public name = the enrollment fact (incl.
    // youth). Only admission can hide it. The registry `authorize` grammar can't
    // express "enrolled in THIS program" per-relation, so the gate lives here —
    // mirrors events/[id] (#571); see docs/security/auth-consistency-analysis.md
    // §4 (principled exception) and §5.1a. The route stays `authorize: 'public'`
    // because the catalog metadata (name/price/dates/spots) drives the public
    // registration page; only the roster is gated.
    //
    // Staff (admin/board/lead/core-vol) or a member of an enrolled household see
    // the rows; everyone else (anonymous, plain authenticated non-enrolled) gets
    // metadata + counts only. The public/register pages need spots-remaining
    // (_count.participants), not names — a count is fine, the names are the leak.
    // The registry orderedView tiers remain as defense-in-depth, stripping
    // pii/personal on the rows for non-staff-but-enrolled callers.
    const isEnrolled = !!sessionUser && program.participants.some(p =>
        p.personId === sessionUser.id ||
        (sessionUser.householdId != null && p.person?.householdId === sessionUser.householdId)
    );
    if (!isPrivileged && !isEnrolled) {
        const metadata: Record<string, unknown> = { ...program };
        delete metadata.volunteers;
        delete metadata.participants;
        return { Program: metadata };
    }

    return { Program: program };
});

// withAuth rejects unauthenticated AND denied households at admission (closes
// GAP-1: this PATCH previously had no denied check), so a denied lead mentor can
// no longer edit their program.
export const PATCH = withAuth({}, async (req, auth, ctx: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await ctx.params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const user = auth.user;
        const isLeadMentor = currentProgram.leadMentorId === user.id;
        const isSysAdminOrBoard = user.isSysadmin || user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Only Admin, Board Members, or Lead Mentors can edit" }, { status: 403 });
        }

        const body = await req.json();
        let { leadMentorId } = body;
        const { name, startAt, endAt, orgMemberOnly, phase, enrollmentStatus, minAge, maxAge, maxParticipants, leadMentorNotificationSettings, memberPrice, nonMemberPrice } = body;

        if (body.hasOwnProperty('leadMentorId')) {
            if (!leadMentorId) {
                return NextResponse.json({ error: "Lead Mentor is required" }, { status: 400 });
            }
            leadMentorId = parseInt(leadMentorId);
            if (isNaN(leadMentorId)) {
                return NextResponse.json({ error: "Invalid lead mentor" }, { status: 400 });
            }
        }

        const updateData: Record<string, unknown> = {
            ...(name !== undefined && { name }),
            ...(leadMentorId !== undefined && { leadMentorId }),
            ...(startAt !== undefined && { startAt: startAt ? new Date(startAt) : null }),
            ...(endAt !== undefined && { endAt: endAt ? new Date(endAt) : null }),
            ...(orgMemberOnly !== undefined && { orgMemberOnly }),
            ...(phase !== undefined && { phase }),
            ...(enrollmentStatus !== undefined && { enrollmentStatus }),
            ...(minAge !== undefined && { minAge }),
            ...(maxAge !== undefined && { maxAge }),
            ...(maxParticipants !== undefined && { maxParticipants }),
            ...(leadMentorNotificationSettings !== undefined && { leadMentorNotificationSettings }),
            ...(memberPrice !== undefined && { orgMemberPriceCents: dollarsToCentsOrNull(memberPrice != null ? String(memberPrice) : undefined) }),
            ...(nonMemberPrice !== undefined && { nonOrgMemberPriceCents: dollarsToCentsOrNull(nonMemberPrice != null ? String(nonMemberPrice) : undefined) }),
        };

        const updatedProgram = await prisma.program.update({
            where: { id: programId },
            data: updateData
        });

        await prisma.auditLog.create({
            data: {
                actorId: auth.user.id,
                action: 'EDIT',
                tableName: 'Program',
                affectedEntityId: updatedProgram.id,
                oldData: currentProgram,
                newData: updatedProgram
            }
        });

        return NextResponse.json({ success: true, program: updatedProgram });
    } catch (error) {
        logger.error("Program update error:", error);
        return NextResponse.json({ error: "Failed to update program" }, { status: 500 });
    }
});
