import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

const DEFAULTS = { id: 1, normalDuesCents: 0, volunteerDuesCents: 0 };

/** GET /api/settings/membership — board settings singleton (created on first read). */
export const GET = withAuth({ roles: ["sysadmin", "boardMember"] }, async () => {
    const settings = await prisma.boardSettings.upsert({ where: { id: 1 }, create: DEFAULTS, update: {} });
    return NextResponse.json({ settings });
});

/**
 * PUT /api/settings/membership — update board settings.
 * Body may include: normalDuesCents, volunteerDuesCents, membershipYearBoundary (ISO|null),
 * membershipVariantId (string|null), volunteerDiscountCode (string|null).
 * Dues must be finite and >= 0; an invalid value rejects the whole update (400) so the
 * previous value survives rather than silently collapsing to zero. (The Averity consent
 * link is an env var, not a board setting.)
 */
export const PUT = withAuth({ roles: ["sysadmin", "boardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: {
        normalDuesCents?: number;
        volunteerDuesCents?: number;
        membershipYearBoundary?: string | null;
        membershipVariantId?: string | null;
        volunteerDiscountCode?: string | null;
        bgRecheckMonths?: number;
    };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    const invalidDues = (v: number) => !Number.isFinite(v) || v < 0;
    if (body.normalDuesCents !== undefined) {
        if (invalidDues(body.normalDuesCents)) return NextResponse.json({ error: "normalDuesCents must be a number >= 0" }, { status: 400 });
        data.normalDuesCents = Math.round(body.normalDuesCents);
    }
    if (body.volunteerDuesCents !== undefined) {
        if (invalidDues(body.volunteerDuesCents)) return NextResponse.json({ error: "volunteerDuesCents must be a number >= 0" }, { status: 400 });
        data.volunteerDuesCents = Math.round(body.volunteerDuesCents);
    }
    if (body.membershipYearBoundary !== undefined) {
        data.membershipYearBoundary = body.membershipYearBoundary ? new Date(body.membershipYearBoundary) : null;
    }
    if (body.membershipVariantId !== undefined) {
        const variantId = body.membershipVariantId?.trim();
        if (variantId && !/^\d+$/.test(variantId)) return NextResponse.json({ error: "membershipVariantId must be a numeric Shopify variant ID" }, { status: 400 });
        data.membershipVariantId = variantId || null;
    }
    if (body.volunteerDiscountCode !== undefined) {
        data.volunteerDiscountCode = body.volunteerDiscountCode?.trim() || null;
    }
    if (body.bgRecheckMonths !== undefined) data.bgRecheckMonths = Math.max(0, Math.round(body.bgRecheckMonths));

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
