import { NextResponse } from "next/server";
import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { logger } from "@/lib/logger";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { config } from "@/lib/config";

/**
 * POST /api/finance-ops/s-read/sync — the board forces an s-read incremental sync
 * now, instead of waiting for the daily 09:00 UTC tick.
 *
 * The reconciler (api/cron/reconcile-shopify) reads a mirror that s-read refreshes
 * once a day, so a payment problem fixed in Shopify this morning still shows as OPEN
 * on the payments queue until tomorrow. This button closes that gap: it re-reads
 * Shopify into the mirror, after which the next reconcile run sees current truth.
 *
 * Invokes the `s-read-<env>-trigger` Lambda — the same entry point the EventBridge
 * schedule uses, which RunTasks the sync family with a SYNC_MODE override
 * (s-read-function/DEPLOY.md). This is deliberately NOT a direct ecs:RunTask from
 * here: the trigger Lambda already owns the cluster/task-def/network wiring, so
 * reusing it keeps this app's IAM grant to a single lambda:InvokeFunction on a
 * single function ARN, and keeps checkin out of the s-read VPC entirely.
 *
 * SECURITY — the mode is a hardcoded literal and the request body is never read.
 * The trigger Lambda also accepts {"mode":"backfill"}, which submits a Shopify Bulk
 * Operation; letting a caller name the mode would turn one board click into an
 * API-budget burn. The IAM grant must likewise cover ONLY this function — never
 * s-replay-function, whose replay/reset-watermark ops re-project financial history
 * and are IAM-gated with mandatory actor/reason audit by design.
 *
 * Concurrency is s-read's problem and s-read already solves it: reserved
 * concurrency = 1 plus the per-store `withSyncRun` lock means a second run while one
 * is in flight is skipped, not corrupted.
 *
 * No AuditLog row: it takes a non-null tableName + affectedEntityId and this touches
 * no checkin entity. The actor is logged here, and s-read stamps its own `sync_run`.
 */
export const POST = withAuth(
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (_req, auth) => {
        if (auth.type !== 'session') {
            return apiError("Unauthorized", 401);
        }

        const functionName = config.sReadTriggerFunction();
        if (!functionName) {
            return apiError("Shopify sync is not wired in this environment", 503);
        }

        try {
            const client = new LambdaClient({ region: config.awsRegion() });
            await client.send(
                new InvokeCommand({
                    FunctionName: functionName,
                    // RequestResponse, not Event: the trigger Lambda only calls RunTask and
                    // returns — it does not wait for the sync itself — so this stays fast
                    // while still surfacing a failed invoke to the board member instead of
                    // silently succeeding.
                    InvocationType: "RequestResponse",
                    Payload: JSON.stringify({ mode: "incremental" }),
                }),
            );

            logger.info(`[s-read] manual incremental sync triggered by user ${auth.user.id}`);
            return NextResponse.json({ success: true });
        } catch (error) {
            logger.error("Failed to trigger s-read sync:", error);
            return apiError("Failed to start the Shopify sync", 500);
        }
    },
);
