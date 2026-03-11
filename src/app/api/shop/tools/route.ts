/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const tools = await prisma.tool.findMany({
            orderBy: { name: 'asc' },
            include: {
                _count: {
                    select: { toolStatuses: true }
                }
            }
        });

        return NextResponse.json(tools);
    } catch (error) {
        console.error("Failed to fetch tools:", error);
        return NextResponse.json({ error: "Failed to fetch tools" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAuthorized = (session.user as any)?.sysadmin || (session.user as any)?.boardMember;

    if (!isAuthorized) {
        return NextResponse.json({ error: "Forbidden: Only admins can create tools" }, { status: 403 });
    }

    try {
        const body = await req.json();
        const { name, safetyGuide } = body;

        if (!name) {
            return NextResponse.json({ error: "Tool name is required" }, { status: 400 });
        }

        const newTool = await prisma.tool.create({
            data: {
                name,
                safetyGuide: safetyGuide || null
            }
        });

        await prisma.auditLog.create({
            data: {
                actorId: parseInt((session.user as any).id, 10),
                action: 'CREATE',
                tableName: 'Tool',
                affectedEntityId: newTool.id,
                newData: JSON.stringify(newTool)
            }
        });

        return NextResponse.json({ success: true, tool: newTool });
    } catch (error: any) {
        console.error("Tool creation error:", error);
        return NextResponse.json({ error: error?.message || "Failed to create tool" }, { status: 500 });
    }
}
