import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { APP_TIMEZONE } from "@/lib/time";
import { APP_LOCALE } from "@/lib/appSettings";

export const dynamic = "force-dynamic";

const DEFAULTS = { id: 1, timezone: APP_TIMEZONE, locale: APP_LOCALE };

/** GET /api/admin/settings/localization — app-wide localization singleton (created on first read). */
export const GET = withAuth({ roles: ["isSysadmin"] }, async () => {
    const settings = await prisma.appSettings.upsert({ where: { id: 1 }, create: DEFAULTS, update: {} });
    return NextResponse.json({ settings });
});

/**
 * PUT /api/admin/settings/localization — update localization settings.
 * Body may include: timezone (IANA), locale (BCP-47). Each is validated against the
 * runtime's Intl tables; an invalid value rejects the whole update (400) so the
 * previous value survives rather than being overwritten with garbage.
 */
export const PUT = withAuth({ roles: ["isSysadmin"] }, async (req, auth) => {
    if (auth.type !== "session") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    let body: { timezone?: string; locale?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (body.timezone !== undefined) {
        const tz = body.timezone.trim();
        if (!Intl.supportedValuesOf("timeZone").includes(tz)) {
            return NextResponse.json({ error: "timezone must be a valid IANA timezone" }, { status: 400 });
        }
        data.timezone = tz;
    }
    if (body.locale !== undefined) {
        const loc = body.locale.trim();
        try {
            if (Intl.getCanonicalLocales(loc)[0] !== loc) throw new Error();
        } catch {
            return NextResponse.json({ error: "locale must be a valid BCP-47 locale" }, { status: 400 });
        }
        data.locale = loc;
    }

    const settings = await prisma.appSettings.upsert({
        where: { id: 1 },
        create: { ...DEFAULTS, ...data },
        update: data,
    });

    await prisma.auditLog.create({
        data: {
            actorId: auth.user.id,
            action: "EDIT",
            tableName: "AppSettings",
            affectedEntityId: 1,
            newData: JSON.stringify(data),
        },
    });

    return NextResponse.json({ settings });
});
