import { processPostEventEmails } from "@/lib/postEventEmails";
import { ApiResponseError, handler } from "@/security/handler";
import { logBackendError } from "@/lib/logger";

/**
 * Expected to be called by an external CRON trigger (e.g. Vercel Cron or CloudWatch Events)
 * GET /api/cron/post-event
 */
export const GET = handler('GET /api/cron/post-event', async () => {
    try {
        // By default, this uses the 1-hour delay rule
        const result = await processPostEventEmails({ forceImmediate: false });
        return { success: true, ...result };
    } catch (err) {
        if (err instanceof ApiResponseError) throw err;
        await logBackendError(err, "GET /api/cron/post-event");
        throw err;
    }
});
