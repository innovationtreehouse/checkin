import prisma from "./prisma";

export const logger = {
    info: (...args: unknown[]) => console.info(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
};

/**
 * Logs a backend error to the database and automatically purges logs older than 30 days.
 * 
 * @param error Error object or string
 * @param route The API route or function name where the error occurred
 * @param context Optional additional context to help with debugging
 */
export async function logBackendError(error: unknown, route?: string, context?: unknown) {
    try {
        const message = error instanceof Error ? error.message : String(error);
        const stack = error instanceof Error ? error.stack : undefined;

        // Log stack trace to centralized logging, never to the database
        if (stack) {
            console.error(`Backend error at ${route || 'unknown route'}:\n`, stack);
        }

        // 1. Insert the new error log
        await prisma.errorLog.create({
            data: {
                message,
                route,
                context: context ? JSON.parse(JSON.stringify(context)) : undefined, // Ensure it's JSON serializable
            }
        });

        // 2. Enforce 30-day TTL: Delete logs older than 30 days
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        await prisma.errorLog.deleteMany({
            where: {
                timestamp: {
                    lt: thirtyDaysAgo
                }
            }
        });
    } catch (loggingError) {
        // Fallback to console if the database logging itself fails
        console.error("Failed to log backend error to database:", loggingError);
        console.error("Original error:", error);
    }
}

/**
 * Persists an external-integration / link failure (Shopify, etc.) for the
 * System Status > Link Status tab, then purges rows older than 90 days.
 *
 * @param source Short integration label, e.g. "shopify" or "shopify-webhook"
 * @param error  Error object or string
 * @param context Optional extra context (program name, ids, etc.)
 */
export async function logIntegrationError(source: string, error: unknown, context?: unknown) {
    try {
        const message = error instanceof Error ? error.message : String(error);

        await prisma.integrationErrorLog.create({
            data: {
                source,
                message,
                context: context ? JSON.parse(JSON.stringify(context)) : undefined,
            },
        });

        // 90-day TTL purge. ponytail: cheap to run on each (rare) write; no cron needed.
        const ninetyDaysAgo = new Date();
        ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
        await prisma.integrationErrorLog.deleteMany({
            where: { timestamp: { lt: ninetyDaysAgo } },
        });
    } catch (loggingError) {
        console.error("Failed to log integration error to database:", loggingError);
        console.error("Original error:", error);
    }
}
