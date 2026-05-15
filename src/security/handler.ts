/**
 * The handler runtime — the only legal way to ship an API response.
 *
 * Flow:
 *   1. Look up the registry entry for endpointKey.
 *   2. Authenticate the request + build the per-request CallerContext (one
 *      DB-heavy prefetch: caller's programs, household, active visitors).
 *   3. Run the admission gate (`authorize`). 401/403 if it fails.
 *   4. Walk `orderedView` top-to-bottom; pick the first role the caller
 *      satisfies. Its tokens become the view.
 *   5. Run the user fn → ModelBag.
 *   6. Recursively strip the bag via stripBag(): for each row, compute its
 *      scopes vs the caller, then per field check `fieldVisible(tier,
 *      tokens, scopes)`. The stripper lives in ./stripper so it can be
 *      unit-tested in isolation.
 *   7. Wrap in envelope, emit.
 *
 * Errors thrown from the user fn are caught:
 *   - `ApiResponseError` → mapped to its declared status & message.
 *   - any other error    → opaque 500 (closes #127/#122 class).
 *
 * IMPORTANT: This file is CODEOWNERS-gated.
 */
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { apiError } from '@/lib/api-response';
import type { AuthResult } from '@/types/auth';
import { getRoute, type Role, type Token } from './core';
import { buildCallerContext, callerHoldsRole, resolveAccess } from './access-resolvers';
import { stripBag } from './stripper';
// Side-effect import to register routes/outbounds before handler() is invoked.
import './registry';

export class ApiResponseError extends Error {
    constructor(
        public readonly status: number,
        message: string,
        public readonly payload?: Record<string, unknown>,
    ) {
        super(message);
        this.name = 'ApiResponseError';
    }
}

export const notFound = (message = 'Not found', payload?: Record<string, unknown>) =>
    new ApiResponseError(404, message, payload);
export const forbidden = (message = 'Forbidden', payload?: Record<string, unknown>) =>
    new ApiResponseError(403, message, payload);
export const badRequest = (message = 'Bad request', payload?: Record<string, unknown>) =>
    new ApiResponseError(400, message, payload);
export const unauthorized = (message = 'Unauthorized', payload?: Record<string, unknown>) =>
    new ApiResponseError(401, message, payload);

export interface HandlerContext<P = Record<string, string>> {
    req: NextRequest;
    auth: AuthResult;
    params: P;
    role: Role;
    /**
     * Pre-read raw request body. Populated only for routes whose `authorize`
     * needs HMAC verification (kiosk or webhook). For routes that don't,
     * this is undefined and fn should read the body itself via `req.text()`,
     * `req.json()`, or `req.formData()`.
     */
    rawBody?: string;
}

export type ModelBag = Record<string, unknown>;
export type HandlerFn<P = Record<string, string>> = (
    ctx: HandlerContext<P>,
) => Promise<ModelBag>;

export function handler<P extends Record<string, string> = Record<string, string>>(
    endpoint: string,
    fn: HandlerFn<P>,
) {
    return async (
        req: NextRequest,
        ctx?: { params?: Promise<P> },
    ): Promise<NextResponse> => {
        const spec = getRoute(endpoint);
        if (!spec) {
            console.error(`[security] No registry entry for ${endpoint}`);
            return apiError('Internal Server Error', 500);
        }

        const params = (ctx?.params ? await ctx.params : ({} as P)) ?? ({} as P);

        // Conditionally read the raw body — needed only for HMAC-verifying
        // auth types (kiosk, webhook). For routes that don't, fn reads the
        // body itself when it needs to.
        const rawBody = needsRawBodyForAuth(spec.authorize)
            ? await req.text()
            : undefined;

        const auth = await authenticateRequest(req, rawBody);
        const callerCtx = await buildCallerContext(auth);

        const { allowed } = await resolveAccess(spec.authorize, {
            auth,
            params,
            callerContext: callerCtx,
            req,
            rawBody,
        });
        if (!allowed) {
            return apiError(
                auth.type === 'unauthenticated' ? 'Unauthorized' : 'Forbidden',
                auth.type === 'unauthenticated' ? 401 : 403,
            );
        }

        let chosenRole: Role | undefined;
        let viewTokens: readonly Token[] = [];
        for (const [role, tokens] of spec.orderedView) {
            if (callerHoldsRole(role, auth, params, callerCtx)) {
                chosenRole = role;
                viewTokens = tokens;
                break;
            }
        }
        if (!chosenRole) {
            // No matching role → empty view. Caller is admitted (authorize
            // passed) but the policy grants them nothing. Fall through with
            // an empty token list; everything will be stripped.
            chosenRole = auth.type === 'unauthenticated' ? 'unauthenticated' : 'authenticated';
        }

        let bag: ModelBag;
        try {
            bag = await fn({ req, auth, params, role: chosenRole, rawBody });
        } catch (err) {
            if (err instanceof ApiResponseError) return apiError(err.message, err.status, err.payload);
            console.error(`[${endpoint}] handler error:`, err);
            return apiError('Internal Server Error', 500);
        }

        let body: unknown;
        if (spec.dangerously_allow_all_data_access) {
            // Stripper bypassed — ship the bag verbatim. `authorize` is the
            // only enforcement; field-level token grants don't apply.
            body = spec.envelope === null ? bag : { [spec.envelope]: bag };
        } else {
            const stripped = stripBag(bag, viewTokens, callerCtx);
            if (spec.envelope === null) {
                const keys = Object.keys(stripped);
                body = keys.length === 1 ? stripped[keys[0]] : stripped;
            } else {
                const keys = Object.keys(stripped);
                const payload = keys.length === 1 ? stripped[keys[0]] : stripped;
                body = { [spec.envelope]: payload };
            }
        }
        return NextResponse.json(body, { status: 200 });
    };
}

/**
 * Returns true if the authorize gate verifies HMAC over the request body
 * (kiosk signature, webhook signature, or any anyOf alternative that does).
 * For these, the handler reads the body once up front so both the auth
 * verifier and the route fn see the same bytes.
 */
function needsRawBodyForAuth(a: import('./core').Authorize): boolean {
    if (typeof a === 'string') return a === 'kiosk';
    if ('webhook' in a) return true;
    if ('anyOf' in a) return a.anyOf.some(needsRawBodyForAuth);
    return false;
}
