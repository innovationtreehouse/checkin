import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const session = await getServerSession(authOptions);

    if (!session) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAuthorized = session.user?.isSysadmin || session.user?.isBoardMember;
    if (!isAuthorized) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const toolId = parseInt(id, 10);
    if (isNaN(toolId)) {
        return NextResponse.json({ error: "Invalid tool ID" }, { status: 400 });
    }

    try {
        const body = await req.json();
        const { name, safetyGuide } = body;

        const data: { name?: string; safetyGuide?: string | null } = {};
        if (name !== undefined) data.name = name;
        if (safetyGuide !== undefined) data.safetyGuide = safetyGuide || null;

        const tool = await prisma.tool.update({
            where: { id: toolId },
            data,
        });

        await prisma.auditLog.create({
            data: {
                actorId: session.user.id,
                action: 'EDIT',
                tableName: 'Tool',
                affectedEntityId: toolId,
                newData: JSON.stringify(tool),
            },
        });

        return NextResponse.json({ success: true, tool });
    } catch (error) {
        await logBackendError(error, "PATCH /api/shop/tools/[id]");
        return NextResponse.json({ error: "Failed to update tool" }, { status: 500 });
    }
}
