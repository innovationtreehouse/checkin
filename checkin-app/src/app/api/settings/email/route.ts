import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { apiError } from "@/lib/api-response";
import { isValidEmailHeader, parseEmailHeaderList } from "@/lib/emailHeader";
import { handler } from "@/security/handler";

export const dynamic = "force-dynamic";

const SELECT = { emailFromAddress: true, emailReplyToAddress: true, scholarshipNotifyEmail: true } as const;

/** GET /api/settings/email — outbound-email sender identity (BoardSettings singleton).
 *  Registry-governed: admission anyRole sysadmin/board; envelope 'settings'.
 *  The narrow SELECT stays as defense in depth. */
export const GET = handler('GET /api/settings/email', async () => {
    const settings = await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, select: SELECT });
    return { BoardSettings: settings };
});

/**
 * PUT /api/settings/email — set the Resend From override, Reply-To, and the
 * Scholarship Review Team notify address. Body may include emailFromAddress,
 * emailReplyToAddress, and scholarshipNotifyEmail (string|null). emailFromAddress
 * is a single address shape (bare or `Name <addr@domain>`). The other two may be a
 * comma-separated list of one or more addresses, each in that same shape (e.g.
 * "info@x.org, ops@x.org") — replies can fan out to more than one inbox. A malformed value
 * rejects the whole update (400) so the previous value survives. Blank/empty clears back to
 * null (env default From; no Reply-To). The From must be on a Resend-verified domain to
 * actually deliver.
 */
export const PUT = withAuth({ roles: ["isSysadmin", "isBoardMember"] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);
    let body: { emailFromAddress?: string | null; emailReplyToAddress?: string | null; scholarshipNotifyEmail?: string | null };
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
        if (replyTo && !parseEmailHeaderList(replyTo)) {
            return apiError("emailReplyToAddress must be a comma-separated list of email addresses (each an address or \"Name <addr@domain>\")", 400);
        }
        data.emailReplyToAddress = replyTo || null;
    }
    if (body.scholarshipNotifyEmail !== undefined) {
        const v = body.scholarshipNotifyEmail?.trim();
        if (v && !parseEmailHeaderList(v)) {
            return apiError("scholarshipNotifyEmail must be a comma-separated list of email addresses (each an address or \"Name <addr@domain>\")", 400);
        }
        data.scholarshipNotifyEmail = v || null; // blank clears to null
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
