import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { config } from "@/lib/config";
import { authOptions, createParticipantWithHousehold } from "@/lib/auth-options";
import { apiError } from "@/lib/api-response";

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/dev-personas
 *
 * Returns @example.com personas (with role flags) that feed the persona picker. Available on
 * the dev instance and local laptops only. Middleware exempts /api, so on the cloud dev instance
 * we additionally require a session here — otherwise an anonymous visitor could enumerate the
 * persona list, violating the "not world-readable" rule. On local no session is required (the
 * logged-out picker is the initial login path).
 */
export async function GET() {
    // Gate on CHECKIN_ENV only (via isDevInstance) — NOT NODE_ENV. The cloud dev instance is a
    // prod build (NODE_ENV=production, CHECKIN_ENV=dev), so a NODE_ENV check would 404 the picker
    // there. isDevInstance() already fails safe to prod. Mirrors the shared dev fence (guard.ts).
    if (!config.isDevInstance()) {
        return apiError("Not available", 404);
    }
    if (config.checkinEnv() === 'dev') {
        // DRIFT-GUARD ALLOWLIST (Step 7): this is the single sanctioned raw
        // getServerSession in app/api/**. It is part of the dev persona-switch
        // mechanism, not a normal authenticated read: on local it must serve
        // anonymous callers (the logged-out picker is the initial login path),
        // and on cloud-dev it gates on ANY session — including a denied one, so
        // a denied dev session can still switch to a non-denied persona. Neither
        // withAuth (401s anonymous) nor getOptionalSessionUser (denied → 404,
        // breaking persona-switch) fits; this route stays on getServerSession.
        const session = await getServerSession(authOptions);
        if (!session?.user) {
            return apiError("Not available", 404);
        }
    }

    const personas = await prisma.person.findMany({
        where: {
            email: { endsWith: "@example.com" },
        },
        select: {
            id: true,
            email: true,
            name: true,
            isSysadmin: true,
            isBoardMember: true,
            isKeyholder: true,
            isBackgroundCheckReviewer: true,
            dateOfBirth: true,
            householdId: true,
            toolStatuses: {
                select: {
                    toolId: true,
                    level: true,
                },
            },
        },
        orderBy: { id: "asc" },
    });

    return NextResponse.json({ personas });
}

/**
 * POST /api/auth/dev-personas
 *
 * Mints a BRAND-NEW empty registrant (single-person household, no children / emergency
 * contact / membership) so the auth-first first-time intake path can be tested on a laptop
 * that has no Google identity. This CREATES a login, so it is gated STRICTER than GET: it
 * must be reachable ONLY on a local laptop — never on cloud 'dev' or prod, where forging a
 * fresh session is out of the question. The server generates the identity; it NEVER accepts
 * a caller-supplied email, so it cannot target or collide with a real person.
 */
export async function POST() {
    if (process.env.NODE_ENV === 'production' || config.checkinEnv() !== 'local') {
        return apiError("Not available", 404);
    }

    // Date.now() is a fine per-mint uniquifier for local dev; @example.com passes authorize()'s
    // filter and the fresh row is impersonated via the existing persona-mint (evaluateMint
    // already relaxes the caller gate on local) — no authorize/evaluateMint change needed.
    const n = Date.now();
    const person = await createParticipantWithHousehold({
        name: `New Family ${n}`,
        email: `newfamily+${n}@example.com`,
    });
    return NextResponse.json({ personaId: person.id });
}
