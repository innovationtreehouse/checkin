// Google Directory API client — Google Group membership add/remove for the
// group-slack-sync feature. Plain `fetch` to admin.googleapis.com / oauth2.googleapis.com;
// no google-auth-library / googleapis dependency (verified absent from package.json —
// spec §0). This is one of the ONLY two files allowed to fetch Google/Slack (the
// other is ./slack.ts) — mirrors the src/lib/shopify.ts / src/lib/email.ts gateway
// discipline so every third-party call for this feature is isolated + testable.
//
// Auth: domain-wide-delegated service account, ONE org-wide credential (not
// per-program — contrast Slack, which is per-program). The SA JSON key lives in
// config.googleDirectorySaKey() (Secrets Manager in prod); config.googleDirectoryConfigured()
// is false when either half of the credential is unset, and the factory below
// returns null in that case (mirrors resendApiKey / shopifyReadDatabaseUrl's
// null-⇒-off pattern — see config.ts).

import crypto from "crypto";
import { config } from "@/lib/config";

export interface GoogleDirectoryClient {
    insertMember(groupEmail: string, memberEmail: string): Promise<GoogleOpResult>;
    removeMember(groupEmail: string, memberEmail: string): Promise<GoogleOpResult>;
}

export type GoogleOpResult =
    | { ok: true; alreadyInDesiredState?: boolean } // 200, or 409 on add / 404 on delete
    | { ok: false; status: number; error: string };

interface DirectoryServiceAccount {
    client_email: string;
    private_key: string;
}

const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DIRECTORY_API_BASE = "https://admin.googleapis.com/admin/directory/v1";

/** Seconds a minted JWT (and thus the access token it buys) is valid for. Google's max is 3600. */
const TOKEN_TTL_SECONDS = 3600;
/** Re-mint this long before actual expiry so a slow request never straddles an expired token. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

function b64url(input: string | Buffer): string {
    return Buffer.from(input as never).toString("base64url");
}

function signJwt(sa: DirectoryServiceAccount, subject: string, nowSec: number): string {
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
        iss: sa.client_email,
        sub: subject,
        scope: DIRECTORY_SCOPE,
        aud: TOKEN_URL,
        iat: nowSec,
        exp: nowSec + TOKEN_TTL_SECONDS,
    };
    const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    const signature = signer.sign(sa.private_key);
    return `${signingInput}.${b64url(signature)}`;
}

interface CachedToken {
    key: string;
    token: string;
    expiresAt: number;
}

/**
 * A token cache is its own closure (not one shared global) so each
 * getGoogleDirectoryClient() instance can carry its own clock (deps.now) without
 * cross-contaminating other instances/tests. The module-level default below is
 * what the standalone mintDirectoryAccessToken (exported for unit tests) uses.
 */
function createTokenCache() {
    let cached: CachedToken | null = null;
    return async function getToken(
        sa: DirectoryServiceAccount,
        subject: string,
        fetchFn: typeof fetch,
        nowMs: number,
    ): Promise<string> {
        const key = `${sa.client_email}:${subject}`;
        if (cached && cached.key === key && nowMs < cached.expiresAt - TOKEN_REFRESH_SKEW_MS) {
            return cached.token;
        }
        const jwt = signJwt(sa, subject, Math.floor(nowMs / 1000));
        const res = await fetchFn(TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion: jwt,
            }).toString(),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => res.statusText);
            throw new Error(`Google Directory token exchange failed: ${res.status} ${text}`);
        }
        const data = (await res.json()) as { access_token: string; expires_in: number };
        cached = { key, token: data.access_token, expiresAt: nowMs + data.expires_in * 1000 };
        return data.access_token;
    };
}

let defaultCache = createTokenCache();

/** @internal Exported only for test isolation (mirrors shopify.ts's resetTokenCache). */
export function resetDirectoryTokenCache(): void {
    defaultCache = createTokenCache();
}

/**
 * Mints a signed JWT (RS256) for the SA and exchanges it for a Directory API access
 * token, cached in-module until ~60s before expiry. No google-auth-library — plain
 * Node crypto (see spec §4.1). Exported standalone (using the module-level default
 * cache + real wall clock) so unit tests can assert on the JWT's shape without going
 * through the factory.
 */
export async function mintDirectoryAccessToken(
    sa: DirectoryServiceAccount,
    subject: string,
    fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
    return defaultCache(sa, subject, fetchFn, Date.now());
}

async function extractGoogleError(res: Response): Promise<string> {
    try {
        const data = (await res.json()) as { error?: { message?: string } };
        return data?.error?.message || res.statusText || `HTTP ${res.status}`;
    } catch {
        return res.statusText || `HTTP ${res.status}`;
    }
}

function parseServiceAccount(raw: string): DirectoryServiceAccount | null {
    try {
        const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
        if (!parsed.client_email || !parsed.private_key) return null;
        return { client_email: parsed.client_email, private_key: parsed.private_key };
    } catch {
        return null;
    }
}

/**
 * Factory: null when unconfigured (config.googleDirectoryConfigured() === false,
 * or the SA key JSON fails to parse — fail closed, same "off" outcome). `deps.now`
 * lets a test drive the token-cache-expiry clock without mocking global Date.
 */
export function getGoogleDirectoryClient(
    deps?: { fetchFn?: typeof fetch; now?: () => number },
): GoogleDirectoryClient | null {
    if (!config.googleDirectoryConfigured()) return null;
    const saRaw = config.googleDirectorySaKey();
    const subject = config.googleDirectoryAdminSubject();
    if (!saRaw || !subject) return null;
    const sa = parseServiceAccount(saRaw);
    if (!sa) return null;

    const fetchFn = deps?.fetchFn ?? globalThis.fetch;
    const nowFn = deps?.now ?? Date.now;
    // Reuse the SAME module-level cache every factory call goes through (not a
    // fresh one per call) — there is only ONE org-wide SA in production, so every
    // insertMember/removeMember across every applyAdd/applyRemove in a reconcile
    // run shares one minted token instead of re-minting a JWT per external call.
    // resetDirectoryTokenCache() (test-only) resets this too, since it reassigns
    // the same `defaultCache` binding.
    const getToken = () => defaultCache(sa, subject, fetchFn, nowFn());

    return {
        async insertMember(groupEmail: string, memberEmail: string): Promise<GoogleOpResult> {
            const token = await getToken();
            const res = await fetchFn(
                `${DIRECTORY_API_BASE}/groups/${encodeURIComponent(groupEmail)}/members`,
                {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ email: memberEmail, role: "MEMBER" }),
                },
            );
            if (res.status === 409) return { ok: true, alreadyInDesiredState: true };
            if (res.ok) return { ok: true };
            return { ok: false, status: res.status, error: await extractGoogleError(res) };
        },

        async removeMember(groupEmail: string, memberEmail: string): Promise<GoogleOpResult> {
            const token = await getToken();
            const res = await fetchFn(
                `${DIRECTORY_API_BASE}/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(memberEmail)}`,
                {
                    method: "DELETE",
                    headers: { Authorization: `Bearer ${token}` },
                },
            );
            if (res.status === 404) return { ok: true, alreadyInDesiredState: true };
            if (res.ok) return { ok: true };
            return { ok: false, status: res.status, error: await extractGoogleError(res) };
        },
    };
}
