/**
 * Centralized environment & configuration management.
 * All process.env access should go through this module.
 */

function requireEnv(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
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
    isDev: process.env.NODE_ENV === 'development',
    baseUrl: (): string => {
        if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
        return process.env.NEXTAUTH_URL || 'http://localhost:4000';
    },
} as const;
