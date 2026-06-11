import { NextResponse } from 'next/server';

/**
 * Create a successful JSON response.
 * Wraps data in a consistent envelope: { data: T }
 * 
 * Note: Some existing endpoints return custom shapes (e.g. { success, participant }).
 * Use apiJson() for those to preserve backward compatibility.
 */
export function apiSuccess<T>(data: T, status = 200) {
    return NextResponse.json({ data }, { status });
}

/**
 * Create an error JSON response.
 * Returns { error: string, details?: unknown }
 */
export function apiError(error: string, status: number, details?: unknown) {
    return NextResponse.json(
        { error, ...(details ? { details } : {}) },
        { status }
    );
}

/**
 * Create a JSON response with a custom shape.
 * Use this for backward-compatible responses that don't fit the { data } envelope.
 */
export function apiJson<T extends Record<string, unknown>>(body: T, status = 200) {
    return NextResponse.json(body, { status });
}
