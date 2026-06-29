import prisma from "@/lib/prisma";
import { APP_TIMEZONE } from "@/lib/time";

/** Default locale, mirrors the AppSettings.locale schema default. */
export const APP_LOCALE = "en-US";

/**
 * App-wide localization config (timezone + locale), read from the AppSettings
 * singleton. The row is created on first read with the schema defaults, so this
 * never returns null. ponytail: queried per call (event creation / trends are
 * low-frequency); add a TTL cache if a hot path ever reads it per-request.
 */
export async function getAppSettings(): Promise<{ timezone: string; locale: string }> {
    const s = await prisma.appSettings.upsert({
        where: { id: 1 },
        create: { id: 1, timezone: APP_TIMEZONE, locale: APP_LOCALE },
        update: {},
    });
    return { timezone: s.timezone, locale: s.locale };
}
