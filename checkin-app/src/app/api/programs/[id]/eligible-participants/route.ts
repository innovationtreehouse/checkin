import { NextResponse, NextRequest } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { ACTIVE_MEMBER_PARTICIPANT_WHERE } from "@/lib/membership";

export const GET = withAuth({}, async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = auth.user.id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = auth.user.isSysadmin || auth.user.isBoardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Not authorized" }, { status: 403 });
        }

        const q = req.nextUrl.searchParams.get("q") || "";

        const andClauses: Prisma.ParticipantWhereInput[] = [
            {
                NOT: {
                    OR: [
                        { programParticipants: { some: { programId } } },
                        { programVolunteers: { some: { programId } } }
                    ]
                }
            }
        ];

        if (q) {
            andClauses.push({
                OR: [
                    { name: { contains: q, mode: 'insensitive' } },
                    { email: { contains: q, mode: 'insensitive' } }
                ]
            });
        }

        if (currentProgram.memberOnly) {
            andClauses.push(ACTIVE_MEMBER_PARTICIPANT_WHERE);
        }

        const members = await prisma.participant.findMany({
            where: andClauses.length > 0 ? { AND: andClauses } : undefined,
            select: { id: true, name: true, email: true, dateOfBirth: true },
            orderBy: { name: 'asc' },
            take: 50
        });

        return NextResponse.json({ members });
    } catch (error) {
        console.error("Failed to fetch eligible participants:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
});
