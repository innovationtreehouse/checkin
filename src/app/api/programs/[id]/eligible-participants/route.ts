/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse, NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const programId = parseInt(id, 10);
        if (isNaN(programId)) {
            return NextResponse.json({ error: "Invalid program ID" }, { status: 400 });
        }

        const currentProgram = await prisma.program.findUnique({ where: { id: programId } });
        if (!currentProgram) {
            return NextResponse.json({ error: "Program not found" }, { status: 404 });
        }

        const currentUserId = (session.user as any).id;
        const isLeadMentor = currentProgram.leadMentorId === currentUserId;
        const isSysAdminOrBoard = (session.user as any)?.sysadmin || (session.user as any)?.boardMember;

        if (!isLeadMentor && !isSysAdminOrBoard) {
            return NextResponse.json({ error: "Forbidden: Not authorized" }, { status: 403 });
        }

        const q = req.nextUrl.searchParams.get("q") || "";

        const andClauses: any[] = [
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
            andClauses.push({
                OR: [
                    { memberships: { some: { active: true } } },
                    { household: { memberships: { some: { active: true } } } }
                ]
            });
        }

        const members = await prisma.participant.findMany({
            where: andClauses.length > 0 ? { AND: andClauses } : undefined,
            select: { id: true, name: true, email: true, dob: true },
            orderBy: { name: 'asc' },
            take: 50
        });

        return NextResponse.json({ members });
    } catch (error) {
        console.error("Failed to fetch eligible participants:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
