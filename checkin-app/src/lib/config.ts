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

/** True only when all three Zoho OAuth secrets are present. */
function zohoConfiguredEnv(): boolean {
    return !!(process.env.ZOHO_CLIENT_ID && process.env.ZOHO_CLIENT_SECRET && process.env.ZOHO_REFRESH_TOKEN);
}

/**
 * The dev/local Zoho Sign MOCK is active when the real integration is unconfigured
 * AND we're on a non-prod instance (see docs/designs/ZOHO_SIGN_DEV_MOCK.md). Two
 * server-only fuses — CHECKIN_ENV (fails safe to prod) and NODE_ENV — so no mock
 * path is reachable in prod by construction. Setting real Zoho secrets in dev opts
 * back into the real client (zohoConfigured wins).
 */
function zohoMockActiveEnv(): boolean {
    return !zohoConfiguredEnv() && readCheckinEnv() !== 'prod' && process.env.NODE_ENV !== 'production';
}

/**
 * Fixed shared secret the dev mock signs its self-fired webhook with (§4a of the
 * design). It guards nothing real — the payload is generated locally — it exists
 * only so verifyZohoToken's real timing-safe compare has a value in dev.
 * Exported for the same reason as DEV_MOCK_SHOPIFY_WEBHOOK_SECRET below.
 */
export const DEV_MOCK_WEBHOOK_SECRET = 'dev-zoho-mock-webhook-secret';

/** Real Shopify integration is wired only when all three credentials are present. */
function shopifyConfiguredEnv(): boolean {
    return !!(process.env.SHOPIFY_STORE_DOMAIN && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}

/**
 * The dev/local Shopify orders/paid MOCK is active when the real integration is
 * unconfigured AND we're on a non-prod instance (see
 * docs/designs/SHOPIFY_DEV_STORE_WEBHOOK.md §6). Same two server-only fuses as the
 * Zoho mock — CHECKIN_ENV (fails safe to prod) and NODE_ENV — so no mock path is
 * reachable in prod by construction. Wiring real Shopify creds opts back into the
 * real store.
 */
function shopifyMockActiveEnv(): boolean {
    return !shopifyConfiguredEnv() && readCheckinEnv() !== 'prod' && process.env.NODE_ENV !== 'production';
}

/**
 * Fixed secret the Shopify mock signs its self-fired orders/paid webhook with.
 * Unlike a real dev store (which signs with Shopify's own per-store secret we
 * don't choose), the mock generates the payload locally, so a fixed constant is
 * enough for verifyShopifyHmac's real timing-safe compare — same rationale as
 * DEV_MOCK_WEBHOOK_SECRET. See §4 of the design: fixed ⇔ self-fired mock.
 *
 * Exported so tests that assert the mock's self-signed webhook verifies can
 * import it instead of duplicating the literal: the tests exercise the fallback
 * wiring, and the exact value is not a contract anything external signs with,
 * so signer and verifier should track one source of truth.
 */
export const DEV_MOCK_SHOPIFY_WEBHOOK_SECRET = 'dev-shopify-mock-webhook-secret';

/**
 * Synthetic membership variant id used when the Shopify mock is active. Programs
 * synthesize dev-mock-variant ids at creation (shopify.ts › createShopifyProgramVariants),
 * but the membership variant is manual BoardSettings config that a local seed never
 * populates — so with no fallback the mock orders/paid webhook can't match a membership
 * order (webhooks/shopify/route.ts) and the dev fire tool 409s. Both the mock firer and
 * the inbound handler fall back to this id when shopifyMockActive(), so local membership
 * dues settle end-to-end with zero setup. Same shape as the program dev-mock ids.
 */
export const DEV_MOCK_MEMBERSHIP_VARIANT_ID = 'dev-mock-variant-membership';

/**
 * The dev/local background-check MOCK is active when the real Averity consent link
 * is unconfigured (AVERITY_CONSENT_URL unset) AND we're on a non-prod instance.
 * Same two server-only fuses as the Zoho/Shopify mocks — CHECKIN_ENV (fails safe to
 * prod) and NODE_ENV — so no mock path is reachable in prod by construction. It hands
 * the applicant an in-app consent link (/dev/bg-consent) instead of Averity's hosted
 * page, so the check can be started in debug mode; board members then sign off through
 * the normal two-reviewer attestation. Setting AVERITY_CONSENT_URL opts back into the
 * real link. See docs/designs/BG_CHECK_DEV_MOCK.md.
 */
function bgMockActiveEnv(): boolean {
    return !process.env.AVERITY_CONSENT_URL && readCheckinEnv() !== 'prod' && process.env.NODE_ENV !== 'production';
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

    // Zoho Sign webhook shared secret (timing-safe compared in verifyZohoToken).
    // Falls back to a fixed dev secret only when the mock is active, so the mock's
    // self-fired webhook (dev interstitial) verifies for real with zero env setup.
    zohoWebhookSecret: (): string | null =>
        process.env.ZOHO_WEBHOOK_SECRET || (zohoMockActiveEnv() ? DEV_MOCK_WEBHOOK_SECRET : null),

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
    // True only when all three OAuth secrets are present — real integration wired.
    zohoConfigured: (): boolean => zohoConfiguredEnv(),
    // True when the dev/local mock provider stands in for real Zoho (secrets unset,
    // non-prod). Selects the mock adapter, skips the S3 PDF load, enables the dev
    // interstitial + its webhook endpoint. Always false in prod. See zohoMockActiveEnv.
    zohoMockActive: (): boolean => zohoMockActiveEnv(),
    // Sign flow is usable when real Zoho is configured OR the dev mock is active.
    // Gates getOrCreateContractSigningUrl + syncContractStatus (replaces the bare
    // zohoConfigured() checks so the mock can drive them in dev).
    zohoAvailable: (): boolean => zohoConfiguredEnv() || zohoMockActiveEnv(),

    // Cron — shared secret gating the session-less cron routes (see cronAuth.ts).
    cronSecret: (): string | null => process.env.CRON_SECRET || null,

    // Shopify — Client Credentials Grant integration (see shopify.ts). All three
    // null when unset (integration "off").
    shopifyStoreDomain: (): string | null => process.env.SHOPIFY_STORE_DOMAIN || null,
    shopifyClientId: (): string | null => process.env.SHOPIFY_CLIENT_ID || null,
    shopifyClientSecret: (): string | null => process.env.SHOPIFY_CLIENT_SECRET || null,
    // Real store's per-store secret, else the fixed mock secret when the mock is
    // active (self-fired webhook verifies for real with zero env setup), else null
    // (unconfigured on a real-but-unwired instance → webhook 500s, the intended fail).
    shopifyWebhookSecret: (): string | null =>
        process.env.SHOPIFY_WEBHOOK_SECRET || (shopifyMockActiveEnv() ? DEV_MOCK_SHOPIFY_WEBHOOK_SECRET : null),
    // True when the dev/local mock stands in for a real Shopify store (creds unset,
    // non-prod). Gates /api/dev/shopify/* + the dev tool. Always false in prod.
    shopifyMockActive: (): boolean => shopifyMockActiveEnv(),

    // True when the dev/local background-check mock stands in for Averity (consent URL
    // unset, non-prod). Selects the mock provider (in-app consent link) and gates
    // /dev/bg-consent + its complete route. Always false in prod. See bgMockActiveEnv.
    bgMockActive: (): boolean => bgMockActiveEnv(),

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
