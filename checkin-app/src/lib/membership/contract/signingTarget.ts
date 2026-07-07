import { config } from "@/lib/config";
import prisma from "@/lib/prisma";

/**
 * Resolves whether contract signing requests go to the in-app mock (the
 * /dev/zoho-sign debug interstitial) or the real Zoho client.
 *
 * Layered on top of config.zohoMockActive() (env-level truth):
 *   - prod (or a production build): always real — the DB override is never
 *     even read. Same two hard fuses as zohoMockActiveEnv().
 *   - creds unset on a non-prod instance: always mock (there is no real
 *     client to talk to) — unchanged local/dev behavior.
 *   - CHECKIN_ENV=dev WITH real creds: BoardSettings.devSigningTarget picks —
 *     'debug' → mock, 'zoho' or NULL → real (the pre-override behavior).
 *
 * DB-backed so the ops-dev instance can flip between real Zoho and debug
 * signing from the settings page without a redeploy.
 */
export async function signingMockActive(): Promise<boolean> {
    if (config.isProd() || process.env.NODE_ENV === "production") return false;
    if (config.zohoMockActive()) return true; // no real creds on a non-prod instance
    if (config.checkinEnv() !== "dev") return false;

    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: { devSigningTarget: true },
    });
    return settings?.devSigningTarget === "debug";
}
