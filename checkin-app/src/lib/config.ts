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

/** Verified Google Workspace hosted-domain (`hd`) allowed on the dev instance. */
export const ORG_DOMAIN = 'innovationtreehouse.org';

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

    // Background check (Averity/VERITY hosted consent deep link). No API — this is a
    // static hosted URL provided out-of-band, so it lives in config, not BoardSettings.
    averityConsentUrl: (): string | null => process.env.AVERITY_CONSENT_URL || null,

    // AWS — region for SDK clients. Set on the ECS task def (AWS_REGION); the
    // default covers local dev. Credentials come from the task role / local profile.
    awsRegion: (): string => process.env.AWS_REGION || 'us-east-2',

    // Membership-agreement PDF — stored in a private S3 bucket (uploaded
    // out-of-band, never committed) and fetched at runtime by the task role.
    // Bucket null when unset → the sign endpoint reports the agreement
    // unavailable (503), the same failure as a missing object. The key has a
    // default so only the bucket must be wired per-env.
    agreementPdfBucket: (): string | null => process.env.AGREEMENT_PDF_S3_BUCKET || null,
    agreementPdfKey: (): string => process.env.AGREEMENT_PDF_S3_KEY || 'membership-agreement.pdf',

    // Zoho Sign — membership-agreement e-signing. The three OAuth secrets are
    // null when unset (integration "off"); the two endpoints default to the .com
    // data center and only need overriding for .eu/.in/etc. See zohoConfigured().
    zohoClientId: (): string | null => process.env.ZOHO_CLIENT_ID || null,
    zohoClientSecret: (): string | null => process.env.ZOHO_CLIENT_SECRET || null,
    zohoRefreshToken: (): string | null => process.env.ZOHO_REFRESH_TOKEN || null,
    zohoAccountsUrl: (): string => process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com',
    zohoSignApi: (): string => process.env.ZOHO_SIGN_API || 'https://sign.zoho.com/api/v1',
    // True only when all three OAuth secrets are present — gates the sign endpoint.
    zohoConfigured: (): boolean =>
        !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN),

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
