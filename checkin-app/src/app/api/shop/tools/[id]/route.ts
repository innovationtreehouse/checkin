import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { logBackendError } from "@/lib/logger";

export const PATCH = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
    if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
                actorId: auth.user.id,
                action: 'EDIT',
                tableName: 'Tool',
                affectedEntityId: toolId,
                newData: tool,
            },
        });

        return NextResponse.json({ success: true, tool });
    } catch (error) {
        await logBackendError(error, "PATCH /api/shop/tools/[id]");
        return NextResponse.json({ error: "Failed to update tool" }, { status: 500 });
    }
});
