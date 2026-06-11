import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULTS = { id: 1, normalDuesCents: 0, volunteerDuesCents: 0 };

/** GET /api/admin/membership/settings — board settings singleton (created on first read). */
export const GET = withAuth({ roles: ["sysadmin", "boardMember"] }, async () => {
    const settings = await prisma.boardSettings.upsert({ where: { id: 1 }, create: DEFAULTS, update: {} });
    return NextResponse.json({ settings });
});

/**
 * PUT /api/admin/membership/settings — update board settings.
 * Body may include: normalDuesCents, volunteerDuesCents, membershipYearBoundary (ISO|null).
 * Dues are clamped to >= 0. (The Averity consent link is an env var, not a board setting.)
 */
export const PUT = withAuth({ roles: ["sysadmin", "boardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: {
        normalDuesCents?: number;
        volunteerDuesCents?: number;
        membershipYearBoundary?: string | null;
    };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (body.normalDuesCents !== undefined) data.normalDuesCents = Math.max(0, Math.round(body.normalDuesCents));
    if (body.volunteerDuesCents !== undefined) data.volunteerDuesCents = Math.max(0, Math.round(body.volunteerDuesCents));
    if (body.membershipYearBoundary !== undefined) {
        data.membershipYearBoundary = body.membershipYearBoundary ? new Date(body.membershipYearBoundary) : null;
    }

    const settings = await prisma.boardSettings.upsert({
        where: { id: 1 },
        create: { ...DEFAULTS, ...data },
        update: data,
    });

    await prisma.auditLog.create({
        data: {
            actorId: auth.user.id,
            action: "EDIT",
            tableName: "BoardSettings",
            affectedEntityId: 1,
            newData: JSON.stringify(data),
        },
    });

    return NextResponse.json({ settings });
});
