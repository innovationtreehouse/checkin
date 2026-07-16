import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { logBackendError } from "@/lib/logger";
import { rateLimit } from "@/lib/rate-limit";
import type { AuthResult } from "@/types/auth";

/** AuthResult minus the unauthenticated case — what the handler is guaranteed. */
export type SignedActor = Exclude<AuthResult, { type: "unauthenticated" }>;

/**
 * Higher-order wrapper for the kiosk/signed-actor route family — the multi-actor
 * sibling of {@link withAuth}/{@link withCron}/{@link withWebhook}.
 *
 * Why this can't be withAuth: withAuth calls authenticateRequest(req) with NO
 * body, so it can only ever see the session. The kiosk HMAC signs the exact
 * request BODY bytes, so a signed-kiosk request can only be authenticated by
 * reading the raw body first and passing it to authenticateRequest(req, rawBody).
 * That is the one thing this wrapper does that withAuth structurally cannot. The
 * authenticated actor may therefore be a kiosk signature OR a logged-in session;
 * both reach the handler, which owns its own actor-specific authorization.
 *
 * Pipeline:
 *   1. per-IP rate limit BEFORE any work;
 *   2. read raw body → authenticateRequest(req, rawBody);
 *   3. reject unauthenticated → 401;
 *   4. JSON parse (malformed → 400);
 *   5. top-level catch → logBackendError + 500, so a handler throw can't escape.
 *
 *   export const POST = withKiosk(
 *       { rateLimit: { name: "scan", limit: 300 } },
 *       async (req, body, auth) => { ... },
 *   );
 */
export function withKiosk<T = unknown>(
    opts: { rateLimit: { name: string; limit: number; windowMs?: number } },
    handler: (req: NextRequest, body: T, auth: SignedActor) => Promise<Response>,
) {
    return async (req: NextRequest): Promise<Response> => {
        // Guard BEFORE reading/verifying so a flood can't burn CPU on signature checks.
        const limited = rateLimit(req, { windowMs: 60_000, ...opts.rateLimit });
        if (limited) return limited;

        try {
            const rawBody = await req.text();

            // Authenticate against the RAW body (kiosk HMAC covers the exact bytes),
            // before parsing untrusted input.
            const auth = await authenticateRequest(req, rawBody);
            if (auth.type === "unauthenticated") {
                return apiError("Unauthorized: Missing kiosk signature or invalid session", 401);
            }

            let body: T;
            try {
                body = JSON.parse(rawBody) as T;
            } catch {
                return apiError("Invalid JSON payload.", 400);
            }

            return await handler(req, body, auth);
        } catch (error) {
            const route = `${req.method} ${new URL(req.url).pathname}`;
            console.error(`Kiosk route error (${route}):`, error);
            await logBackendError(error, route);
            return apiError("Internal Server Error", 500);
        }
    };
}
