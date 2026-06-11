/**
 * Standardized API response types.
 */
export type ApiSuccess<T> = { data: T };
export type ApiError = { error: string; details?: unknown };
