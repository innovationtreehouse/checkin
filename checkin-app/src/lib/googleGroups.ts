// Google Admin SDK Directory API client for program → Google Group membership
// sync. Auth is a service account with domain-wide delegation: we mint an OAuth2
// access token from a self-signed JWT-bearer assertion (no googleapis dependency
// — it's plain REST + a crypto-signed JWT). Structure mirrors lib/shopify.ts:
// a googleFetch() timeout seam so tests mock global.fetch, a cached token, typed
// errors, and idempotent writes. See docs/designs/PROGRAM_GOOGLE_GROUP_SYNC.md.

import crypto from "crypto";
import { config } from "@/lib/config";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DIRECTORY_BASE = "https://admin.googleapis.com/admin/directory/v1";
const SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";

/** Hard per-request deadline for every Google call — same rationale as
 * SHOPIFY_FETCH_TIMEOUT_MS: a hung TCP connection must surface as an error, not
 * pin a request worker until the platform timeout. */
const GOOGLE_FETCH_TIMEOUT_MS = 15_000;

/** Typed failure for every Google Directory error, carrying the HTTP status when
 * there was one, so callers (best-effort push vs. loud manual sync) can branch. */
export class GoogleGroupsError extends Error {
    constructor(message: string, public readonly status?: number) {
        super(message);
        this.name = "GoogleGroupsError";
    }
}

export interface GroupMember {
    email: string;
    /** OWNER | MANAGER | MEMBER — reconcile only removes MEMBER-role addresses. */
    role: string;
}

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

/** @internal - exported only for test isolation (mirrors shopify.resetTokenCache). */
export function resetTokenCache() {
    cachedToken = null;
    tokenExpiresAt = 0;
}

interface ServiceAccountKey {
    client_email: string;
    private_key: string;
}

/** Parse GOOGLE_SA_KEY_JSON → {client_email, private_key}, or null when unset /
 * malformed / missing a required field (treated as "unconfigured", not an error). */
function loadServiceAccount(): ServiceAccountKey | null {
    const raw = config.googleSaKeyJson();
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        if (typeof parsed?.client_email === "string" && typeof parsed?.private_key === "string") {
            return { client_email: parsed.client_email, private_key: parsed.private_key };
        }
    } catch {
        // fall through
    }
    console.error("[GOOGLE-GROUPS] GOOGLE_SA_KEY_JSON is set but not valid service-account JSON.");
    return null;
}

function base64url(input: string | Buffer): string {
    return Buffer.from(input).toString("base64url");
}

/** Build + RS256-sign the JWT-bearer assertion Google exchanges for an access
 * token. `sub` is the admin the service account impersonates (domain-wide
 * delegation). */
function signJwtAssertion(sa: ServiceAccountKey, subject: string): string {
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const claims = base64url(
        JSON.stringify({
            iss: sa.client_email,
            sub: subject,
            scope: SCOPE,
            aud: GOOGLE_TOKEN_URL,
            iat: now,
            exp: now + 3600,
        }),
    );
    const signingInput = `${header}.${claims}`;
    const signature = crypto.createSign("RSA-SHA256").update(signingInput).sign(sa.private_key);
    return `${signingInput}.${base64url(signature)}`;
}

/** fetch with a hard timeout that surfaces as a GoogleGroupsError instead of hanging. */
export async function googleFetch(input: string, init: RequestInit, label: string): Promise<Response> {
    try {
        return await fetch(input, { ...init, signal: AbortSignal.timeout(GOOGLE_FETCH_TIMEOUT_MS) });
    } catch (err) {
        if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
            throw new GoogleGroupsError(`${label} timed out after ${GOOGLE_FETCH_TIMEOUT_MS}ms`);
        }
        throw err;
    }
}

/** Mint (and cache, refreshing ~5 min early) an access token from the JWT-bearer
 * assertion. Returns null when the integration is unconfigured; throws
 * GoogleGroupsError on a real token-exchange failure. */
async function getAccessToken(): Promise<string | null> {
    const sa = loadServiceAccount();
    const subject = config.googleSaSubject();
    if (!sa || !subject) return null;

    if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
        return cachedToken;
    }

    const assertion = signJwtAssertion(sa, subject);
    const res = await googleFetch(
        GOOGLE_TOKEN_URL,
        {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
                assertion,
            }).toString(),
        },
        "Google token exchange",
    );

    if (!res.ok) {
        cachedToken = null;
        throw new GoogleGroupsError(`Google token exchange failed: ${res.status} ${await res.text()}`, res.status);
    }

    const data = await res.json();
    cachedToken = data.access_token;
    // expires_in is seconds (Google returns 3599); default defensively.
    tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    return cachedToken;
}

/** Require a token or fail with a clear typed error (the service layer gates on
 * config.googleGroupsConfigured() before calling, so null here is unexpected). */
async function requireToken(): Promise<string> {
    const token = await getAccessToken();
    if (!token) throw new GoogleGroupsError("Google Directory integration is not configured");
    return token;
}

/** All members of a group (paginated), lowercased, with their Directory role. */
export async function listGroupMembers(groupEmail: string): Promise<GroupMember[]> {
    const token = await requireToken();
    const members: GroupMember[] = [];
    let pageToken: string | undefined;

    do {
        const url =
            `${DIRECTORY_BASE}/groups/${encodeURIComponent(groupEmail)}/members?maxResults=200` +
            (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
        const res = await googleFetch(url, { headers: { Authorization: `Bearer ${token}` } }, "Google list members");
        if (!res.ok) {
            throw new GoogleGroupsError(`Google list members failed for ${groupEmail}: ${res.status} ${await res.text()}`, res.status);
        }
        const data = await res.json();
        for (const m of data.members ?? []) {
            if (m?.email) members.push({ email: String(m.email).toLowerCase(), role: String(m.role ?? "MEMBER") });
        }
        pageToken = data.nextPageToken;
    } while (pageToken);

    return members;
}

/** Add one address to the group. Idempotent: a 409 (already a member) is success. */
export async function addGroupMember(groupEmail: string, email: string): Promise<void> {
    const token = await requireToken();
    const res = await googleFetch(
        `${DIRECTORY_BASE}/groups/${encodeURIComponent(groupEmail)}/members`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ email, role: "MEMBER" }),
        },
        "Google add member",
    );
    if (res.status === 409) return; // already a member — idempotent
    if (!res.ok) {
        throw new GoogleGroupsError(`Google add member failed (${email} → ${groupEmail}): ${res.status} ${await res.text()}`, res.status);
    }
}

/** Remove one address from the group. Idempotent: a 404 (not a member) is success. */
export async function removeGroupMember(groupEmail: string, email: string): Promise<void> {
    const token = await requireToken();
    const res = await googleFetch(
        `${DIRECTORY_BASE}/groups/${encodeURIComponent(groupEmail)}/members/${encodeURIComponent(email)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
        "Google remove member",
    );
    if (res.status === 404) return; // not a member — idempotent
    if (!res.ok) {
        throw new GoogleGroupsError(`Google remove member failed (${email} → ${groupEmail}): ${res.status} ${await res.text()}`, res.status);
    }
}
