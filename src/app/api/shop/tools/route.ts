import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";

export async function GET() {
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
        await logBackendError(error, "GET /api/shop/tools");
        return NextResponse.json({ error: "Failed to fetch tools" }, { status: 500 });
    }
}

export async function POST(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAuthorized = session.user?.sysadmin || session.user?.boardMember || session.user?.shopSteward;

    if (!isAuthorized) {
        return NextResponse.json({ error: "Forbidden: Only admins, board members, and shop stewards can create tools" }, { status: 403 });
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
                actorId: session.user.id,
                action: 'CREATE',
                tableName: 'Tool',
                affectedEntityId: newTool.id,
                newData: JSON.stringify(newTool)
            }
        });

        return NextResponse.json({ success: true, tool: newTool });
    } catch (error: unknown) {
        await logBackendError(error, "POST /api/shop/tools");
        return NextResponse.json({ error: "Failed to create tool" }, { status: 500 });
    }
}
