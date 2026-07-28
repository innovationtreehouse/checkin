import { NextResponse } from "next/server";
import { canonicalizeEmail } from "@/lib/emailNormalize";

// In-memory fixed-window rate limiter keyed by client IP and/or normalized email.
//
// ponytail: process-local — one Map per instance, no external store. Correct for
// the single container this app ships as (Dockerfile, next `output: 'standalone'`).
// If it ever runs multi-instance/serverless, each instance keeps its own window,
// so the effective limit multiplies by the instance count and a client can hop
// instances to dodge it — move the counter to a shared store (Redis/Upstash) then.

interface Window {
    count: number;
    resetAt: number; // epoch ms when the current window expires
}

// Map<bucketKey, Window>. bucketKey = `${name}:${ip|email}` so each route's limit
// is independent. Stale entries are pruned lazily on access; a coarse sweep keeps
// the map from growing unbounded under churn of distinct keys.
const buckets = new Map<string, Window>();
let lastSweep = 0;

function sweep(now: number) {
    // Sweep at most once a minute; cheap insurance against unbounded growth.
    if (now - lastSweep < 60_000) return;
    lastSweep = now;
    for (const [key, w] of buckets) {
        if (w.resetAt <= now) buckets.delete(key);
    }
}

/**
 * Pure fixed-window check. Returns whether the call is allowed and, when not,
 * how many whole seconds until the window resets (for the Retry-After header).
 * Exported for the self-check; routes use {@link rateLimit} / {@link rateLimitEmail}.
 */
export function checkRateLimit(
    key: string,
    limit: number,
    windowMs: number,
    now: number,
): { ok: boolean; retryAfterSec: number } {
    const w = buckets.get(key);
    if (!w || w.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { ok: true, retryAfterSec: 0 };
    }
    if (w.count < limit) {
        w.count++;
        return { ok: true, retryAfterSec: 0 };
    }
    return { ok: false, retryAfterSec: Math.ceil((w.resetAt - now) / 1000) };
}

/**
 * Bucket key for the client IP. IPv6 is collapsed to its /64 prefix (first 4
 * hextets) so an attacker who controls a whole allocation can't mint unlimited
 * fresh buckets by hopping addresses within it; IPv4 keeps its full address.
 *
 * ponytail: trusts the leftmost x-forwarded-for hop — assumes the ingress
 * overwrites any inbound XFF. If the app ever becomes directly reachable, XFF is
 * client-spoofable and this keying must move to a trusted hop (e.g. the Nth from
 * the right, counted against the known proxy chain length).
 */
export function clientIpKey(req: Request): string {
    const xff = req.headers.get("x-forwarded-for");
    const raw = xff
        ? xff.split(",")[0].trim()
        : req.headers.get("x-real-ip")?.trim() || "unknown";

    // IPv6 if it contains a colon. Collapse to the /64 routing prefix so the
    // whole allocation shares one bucket. "::" and "::1" expand to all-zero
    // hextets, which is fine — they collapse to a single stable key.
    if (raw.includes(":")) {
        const hextets = raw.split(":");
        // A "::" leaves empty segments; pad so we always take 4 leading hextets.
        while (hextets.length < 8) hextets.splice(hextets.indexOf(""), 0, "0");
        return hextets.slice(0, 4).map((h) => h || "0").join(":") + "::/64";
    }
    return raw;
}

function tooMany(retryAfterSec: number): NextResponse {
    return NextResponse.json(
        { error: "Too many requests. Please slow down and try again shortly." },
        { status: 429, headers: { "Retry-After": String(retryAfterSec) } },
    );
}

/**
 * Enforce a per-IP rate limit for one route. Returns a 429 NextResponse when the
 * caller is over the limit (caller should return it), or null to proceed.
 *
 *   const limited = rateLimit(req, { name: "signin", limit: 5, windowMs: 60_000 });
 *   if (limited) return limited;
 */
export function rateLimit(
    req: Request,
    opts: { name: string; limit: number; windowMs: number },
): NextResponse | null {
    const now = Date.now();
    sweep(now);
    const { ok, retryAfterSec } = checkRateLimit(
        `${opts.name}:ip:${clientIpKey(req)}`,
        opts.limit,
        opts.windowMs,
        now,
    );
    return ok ? null : tooMany(retryAfterSec);
}

/**
 * Enforce a per-normalized-email rate limit. Use alongside {@link rateLimit} on
 * endpoints that email an address the caller supplies, so an attacker can't bomb
 * a victim by rotating address variants that all deliver to the same inbox.
 */
export function rateLimitEmail(
    email: string,
    opts: { name: string; limit: number; windowMs: number },
): NextResponse | null {
    const now = Date.now();
    sweep(now);
    const { ok, retryAfterSec } = checkRateLimit(
        `${opts.name}:email:${canonicalizeEmail(email)}`,
        opts.limit,
        opts.windowMs,
        now,
    );
    return ok ? null : tooMany(retryAfterSec);
}
