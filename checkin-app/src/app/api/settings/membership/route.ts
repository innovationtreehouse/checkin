import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

const DEFAULTS = { id: 1, standardMembershipFeeCents: 0, volunteerMembershipFeeCents: 0 };

/** GET /api/settings/membership — board settings singleton (created on first read). */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const settings = await prisma.boardSettings.upsert({ where: { id: 1 }, create: DEFAULTS, update: {} });
    return NextResponse.json({ settings });
});

/**
 * PUT /api/settings/membership — update board settings.
 * Body may include: standardMembershipFeeCents, volunteerMembershipFeeCents, orgMembershipYearBoundary (ISO|null),
 * orgMembershipVariantId (string|null),
 * orgMembershipProductUrl (string|null), volunteerDiscountCode (string|null),
 * scholarshipDenialGraceDays (positive int|null — null disables the grace-period expiry cron).
 * Membership fees must be finite and >= 0; an invalid value rejects the whole update (400) so the
 * previous value survives rather than silently collapsing to zero. (The Averity consent
 * link is an env var, not a board setting. Email sender identity lives in /api/settings/email.)
 */
export const PUT = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: {
        standardMembershipFeeCents?: number;
        volunteerMembershipFeeCents?: number;
        orgMembershipYearBoundary?: string | null;
        orgMembershipVariantId?: string | null;
        orgMembershipProductUrl?: string | null;
        volunteerDiscountCode?: string | null;
        bgRecheckMonths?: number;
        devSigningTarget?: string | null;
        scholarshipDenialGraceDays?: number | null;
    };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }

    const data: Record<string, unknown> = {};
    const invalidFee = (v: number) => !Number.isFinite(v) || v < 0;
    if (body.standardMembershipFeeCents !== undefined) {
        if (invalidFee(body.standardMembershipFeeCents)) return apiError("standardMembershipFeeCents must be a number >= 0", 400);
        data.standardMembershipFeeCents = Math.round(body.standardMembershipFeeCents);
    }
    if (body.volunteerMembershipFeeCents !== undefined) {
        if (invalidFee(body.volunteerMembershipFeeCents)) return apiError("volunteerMembershipFeeCents must be a number >= 0", 400);
        data.volunteerMembershipFeeCents = Math.round(body.volunteerMembershipFeeCents);
    }
    if (body.orgMembershipYearBoundary !== undefined) {
        data.orgMembershipYearBoundary = body.orgMembershipYearBoundary ? new Date(body.orgMembershipYearBoundary) : null;
    }
    if (body.orgMembershipVariantId !== undefined) {
        const variantId = body.orgMembershipVariantId?.trim();
        if (variantId && !/^\d+$/.test(variantId)) return apiError("orgMembershipVariantId must be a numeric Shopify variant ID", 400);
        data.orgMembershipVariantId = variantId || null;
    }
    // Reference only — the checkout link is built from the variant ID, never this
    // URL, and /extract-variant re-validates it hard before any server-side fetch.
    if (body.orgMembershipProductUrl !== undefined) {
        data.orgMembershipProductUrl = body.orgMembershipProductUrl?.trim() || null;
    }
    if (body.volunteerDiscountCode !== undefined) {
        data.volunteerDiscountCode = body.volunteerDiscountCode?.trim() || null;
    }
    if (body.bgRecheckMonths !== undefined) data.bgRecheckMonths = Math.max(0, Math.round(body.bgRecheckMonths));
    if (body.devSigningTarget !== undefined) {
        // Dev-instance-only knob (signing target radio). Rejected outright on any
        // other env so prod's DB can never even hold a value — the read side
        // (signingMockActive) has its own hard fuse regardless.
        if (config.checkinEnv() !== "dev") {
            return apiError("devSigningTarget can only be set on a dev instance", 400);
        }
        if (body.devSigningTarget !== null && body.devSigningTarget !== "zoho" && body.devSigningTarget !== "debug") {
            return apiError("devSigningTarget must be 'zoho', 'debug', or null", 400);
        }
        data.devSigningTarget = body.devSigningTarget;
    }
    // scholarshipDenialGraceDays: null = feature off (never guess a default); otherwise a positive integer.
    if (body.scholarshipDenialGraceDays !== undefined) {
        if (body.scholarshipDenialGraceDays !== null) {
            if (!Number.isFinite(body.scholarshipDenialGraceDays) || !Number.isInteger(body.scholarshipDenialGraceDays) || body.scholarshipDenialGraceDays <= 0) {
                return apiError("scholarshipDenialGraceDays must be a positive whole number of days, or null", 400);
            }
        }
        data.scholarshipDenialGraceDays = body.scholarshipDenialGraceDays;
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
