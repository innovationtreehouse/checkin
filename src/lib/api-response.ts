import { NextResponse } from 'next/server';

/**
 * Create an error JSON response. Used by the security handler to emit
 * 4xx/5xx responses; route files should NOT call this directly — throw
 * `badRequest()` / `notFound()` / `forbidden()` / `unauthorized()` from
 * `@/security/handler` instead.
 *
 * Returns { error: string, details?: unknown }.
 */
export function apiError(error: string, status: number, details?: unknown) {
    return NextResponse.json(
        { error, ...(details ? { details } : {}) },
        { status },
    );
}
