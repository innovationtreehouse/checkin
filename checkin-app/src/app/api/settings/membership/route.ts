import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

const DEFAULTS = { id: 1, normalDuesCents: 0, volunteerDuesCents: 0 };

/**
 * Accept a bare address (`a@b.co`) or a display-name form (`Name <a@b.co>`) — the
 * two shapes Resend allows for From/Reply-To. Rejects anything without a plausible
 * address so a typo can't silently break (From) or misroute (Reply-To) all mail.
 */
function isValidEmailHeader(value: string): boolean {
    const angle = value.match(/<([^>]*)>\s*$/);
    const addr = (angle ? angle[1] : value).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

/** GET /api/settings/membership — board settings singleton (created on first read). */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const settings = await prisma.boardSettings.upsert({ where: { id: 1 }, create: DEFAULTS, update: {} });
    return NextResponse.json({ settings });
});

/**
 * PUT /api/settings/membership — update board settings.
 * Body may include: normalDuesCents, volunteerDuesCents, orgMembershipYearBoundary (ISO|null),
 * orgMembershipVariantId (string|null), volunteerDiscountCode (string|null),
 * emailFromAddress (string|null), emailReplyToAddress (string|null).
 * Dues must be finite and >= 0, and email headers must be a valid address shape; an invalid
 * value rejects the whole update (400) so the previous value survives rather than silently
 * collapsing to zero. (The Averity consent link is an env var, not a board setting.)
 */
export const PUT = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: {
        normalDuesCents?: number;
        volunteerDuesCents?: number;
        orgMembershipYearBoundary?: string | null;
        orgMembershipVariantId?: string | null;
        volunteerDiscountCode?: string | null;
        bgRecheckMonths?: number;
        emailFromAddress?: string | null;
        emailReplyToAddress?: string | null;
    };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }

    const data: Record<string, unknown> = {};
    const invalidDues = (v: number) => !Number.isFinite(v) || v < 0;
    if (body.normalDuesCents !== undefined) {
        if (invalidDues(body.normalDuesCents)) return apiError("normalDuesCents must be a number >= 0", 400);
        data.normalDuesCents = Math.round(body.normalDuesCents);
    }
    if (body.volunteerDuesCents !== undefined) {
        if (invalidDues(body.volunteerDuesCents)) return apiError("volunteerDuesCents must be a number >= 0", 400);
        data.volunteerDuesCents = Math.round(body.volunteerDuesCents);
    }
    if (body.orgMembershipYearBoundary !== undefined) {
        data.orgMembershipYearBoundary = body.orgMembershipYearBoundary ? new Date(body.orgMembershipYearBoundary) : null;
    }
    if (body.orgMembershipVariantId !== undefined) {
        const variantId = body.orgMembershipVariantId?.trim();
        if (variantId && !/^\d+$/.test(variantId)) return apiError("orgMembershipVariantId must be a numeric Shopify variant ID", 400);
        data.orgMembershipVariantId = variantId || null;
    }
    if (body.volunteerDiscountCode !== undefined) {
        data.volunteerDiscountCode = body.volunteerDiscountCode?.trim() || null;
    }
    if (body.bgRecheckMonths !== undefined) data.bgRecheckMonths = Math.max(0, Math.round(body.bgRecheckMonths));
    if (body.emailFromAddress !== undefined) {
        const from = body.emailFromAddress?.trim();
        if (from && !isValidEmailHeader(from)) return apiError("emailFromAddress must be an email address or \"Name <addr@domain>\"", 400);
        data.emailFromAddress = from || null;
    }
    if (body.emailReplyToAddress !== undefined) {
        const replyTo = body.emailReplyToAddress?.trim();
        if (replyTo && !isValidEmailHeader(replyTo)) return apiError("emailReplyToAddress must be an email address or \"Name <addr@domain>\"", 400);
        data.emailReplyToAddress = replyTo || null;
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
            // data holds a Date (orgMembershipYearBoundary); clone to a JSON-safe object.
            newData: JSON.parse(JSON.stringify(data)),
        },
    });

    return NextResponse.json({ settings });
});
