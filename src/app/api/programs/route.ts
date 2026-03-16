/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { sendNotification } from "@/lib/notifications";

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    try {
        const { searchParams } = new URL(req.url);
        const activeOnly = searchParams.get("active") === "true";

        // Determine if the user is allowed to see memberOnly programs
        let canSeeMemberOnly = false;

        if (session && session.user) {
            const user = session.user as any;
            if (user.sysadmin || user.boardMember) {
                canSeeMemberOnly = true;
            } else {
                // Check if user has an active membership
                const participant = await prisma.participant.findUnique({
                    where: { id: user.id },
                    include: {
                        memberships: {
                            where: { active: true }
                        }
                    }
                });
                if (participant && participant.memberships.length > 0) {
                    canSeeMemberOnly = true;
                }
            }
        }

        const andClauses: any[] = [];

        if (activeOnly) {
            andClauses.push({
                OR: [
                    { end: null },
                    { end: { gte: new Date() } }
                ]
            });
        }

        if (!canSeeMemberOnly) {
            andClauses.push({ memberOnly: false });
        }

        let canSeeDrafts = false;
        let userId: number | undefined;
        if (session && session.user) {
            userId = parseInt((session.user as any).id, 10);
            if ((session.user as any).sysadmin || (session.user as any).boardMember) {
                canSeeDrafts = true;
            }
        }

        if (!canSeeDrafts) {
            if (userId && !isNaN(userId)) {
                andClauses.push({
                    OR: [
                        { phase: { not: 'PLANNING' } },
                        { leadMentorId: userId }
                    ]
                });
            } else {
                andClauses.push({ phase: { not: 'PLANNING' } });
            }
        }

        const programs = await prisma.program.findMany({
            where: andClauses.length > 0 ? { AND: andClauses } : undefined,
            orderBy: { begin: 'asc' },
            include: {
                _count: {
                    select: {
                        participants: true,
                        volunteers: true,
                        events: true
                    }
                }
            }
        });

        return NextResponse.json(programs);
    } catch (error) {
        console.error("Failed to fetch programs:", error);
        return NextResponse.json({ error: "Failed to fetch programs" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);
    const canCreate = (session?.user as any)?.sysadmin || (session?.user as any)?.boardMember;

    if (!session || !canCreate) {
        return NextResponse.json({ error: "Forbidden: Only Admin or Board Members can create programs" }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { name, leadMentorId, begin, end, memberOnly, minAge, maxAge } = body;

        if (!name) {
            return NextResponse.json({ error: "Program name is required" }, { status: 400 });
        }

        const newProgram = await prisma.program.create({
            data: {
                name,
                leadMentorId: leadMentorId || null,
                begin: begin ? new Date(begin) : null,
                end: end ? new Date(end) : null,
                memberOnly: memberOnly || false,
                minAge: minAge || null,
                maxAge: maxAge || null
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: parseInt((session.user as any).id, 10),
                action: 'CREATE',
                tableName: 'Program',
                affectedEntityId: newProgram.id,
                newData: JSON.stringify(newProgram)
            }
        });

        if (newProgram.leadMentorId) {
            await sendNotification(newProgram.leadMentorId, 'PROGRAM_ASSIGNMENT', { programName: newProgram.name });
        }

        return NextResponse.json({ success: true, program: newProgram });
    } catch (error: any) {
        console.error("Program creation error:", error);
        return NextResponse.json({ error: error?.message || "Failed to create program" }, { status: 500 });
    }
}
