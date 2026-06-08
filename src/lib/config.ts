/**
 * Centralized environment & configuration management.
 * All process.env access should go through this module.
 */

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
}

/**
 * The single environment-personality switch (see docs/designs/DEV_INSTANCE_DESIGN.md).
 *   prod  — production (default when unset). Real data, public landing, no impersonation.
 *   dev   — cloud dev instance. Entire site behind org login.
 *   local — a developer laptop. Permits offline credential login + keyless kiosk.
 *
 * IMPORTANT: this is server-only. CHECKIN_ENV is intentionally NOT NEXT_PUBLIC_, so it is
 * never inlined into the client bundle (which keeps the same image safe in every environment).
 * Client components must read it via useCheckinEnv() (see components/EnvProvider), never here.
 */
export type CheckinEnv = 'prod' | 'dev' | 'local';

function readCheckinEnv(): CheckinEnv {
    const value = process.env.CHECKIN_ENV;
    // Anything unrecognized — including unset — fails safe to prod.
    return value === 'dev' || value === 'local' ? value : 'prod';
}

export const config = {
    // Database
    databaseUrl: () => requireEnv('DATABASE_URL'),

    // Auth
    nextAuthUrl: () => process.env.NEXTAUTH_URL || 'http://localhost:4000',
    nextAuthSecret: () => requireEnv('NEXTAUTH_SECRET'),
    googleClientId: () => requireEnv('GOOGLE_CLIENT_ID'),
    googleClientSecret: () => requireEnv('GOOGLE_CLIENT_SECRET'),

    // Kiosk
    kioskPublicKey: (): string | null => process.env.KIOSK_PUBLIC_KEY || null,

    // Email
    resendApiKey: (): string | null => process.env.RESEND_API_KEY || null,
    emailFrom: () => process.env.EMAIL_FROM || 'CheckMeIn <onboarding@resend.dev>',

    // App
    checkinEnv: (): CheckinEnv => readCheckinEnv(),
    // Production (default when unset). Consumers should call this rather than
    // string-comparing checkinEnv() so the env predicates live in one place.
    isProd: (): boolean => readCheckinEnv() === 'prod',
    // True on the cloud dev instance OR a local laptop (i.e. not prod). Server-only.
    isDevInstance: (): boolean => readCheckinEnv() !== 'prod',
    // True only on a developer laptop. Gates offline credential login + keyless kiosk.
    isLocal: (): boolean => readCheckinEnv() === 'local',
    baseUrl: (): string => {
        if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
        return process.env.NEXTAUTH_URL || 'http://localhost:4000';
    },
} as const;
