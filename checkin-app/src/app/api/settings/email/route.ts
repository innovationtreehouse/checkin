import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { isValidEmailHeader } from "@/lib/emailHeader";

export const dynamic = "force-dynamic";

const SELECT = { emailFromAddress: true, emailReplyToAddress: true } as const;

/** GET /api/settings/email — outbound-email sender identity (BoardSettings singleton). */
export const GET = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async () => {
    const settings = await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, select: SELECT });
    return NextResponse.json({ settings });
});

/**
 * PUT /api/settings/email — set the Resend From override and Reply-To.
 * Body may include emailFromAddress and emailReplyToAddress (string|null). Each must be a
 * valid address shape (bare or `Name <addr@domain>`); a malformed value rejects the whole
 * update (400) so the previous value survives. Blank/empty clears back to null (env default
 * From; no Reply-To). The From must be on a Resend-verified domain to actually deliver.
 */
export const PUT = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: { emailFromAddress?: string | null; emailReplyToAddress?: string | null };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }

    const data: Record<string, string | null> = {};
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
        create: { id: 1, ...data },
        update: data,
        select: SELECT,
    });

    await prisma.auditLog.create({
        data: {
            actorId: auth.user.id,
            action: "EDIT",
            tableName: "BoardSettings",
            affectedEntityId: 1,
            newData: data,
        },
    });

    return NextResponse.json({ settings });
});
