/**
 * Shopify Bulk Operation lifecycle for the orders backfill.
 *
 * Bulk operations run asynchronously on Shopify's side: start one, then poll
 * `currentBulkOperation` on later invocations until COMPLETED, then download the JSONL
 * result. The reassembly of that JSONL into nested order nodes — and its durable, verbatim
 * pre-transform capture — lives in @inventory/s-ingest-core so the same code path can also
 * drive recovery (reingestBulkExports). `reassembleOrders` / `parseBulkJsonl` are re-exported
 * here for callers and tests that import them from this module.
 *
 * NOTE: `shopifyPaymentsAccount` is a singleton, not a top-level connection, so
 * payouts/balance-transactions are NOT bulk-exportable as a top-level query — the
 * backfill pulls those via the paginated cursor fetchers instead (see sync/backfill).
 */
import { logger } from "@inventory/s-ingest-core";
import type { ShopifyClient } from "./client.js";
import { jitteredBackoffMs } from "./client.js";
import {
  BULK_OPERATION_RUN_MUTATION,
  CURRENT_BULK_OPERATION_QUERY,
  buildOrdersBulkQuery,
} from "./queries.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Hard client-side deadline for the JSONL download; a hung GCS read must not run to the Lambda timeout. */
export const BULK_DOWNLOAD_TIMEOUT_MS = 60_000;
/** Bounded retries for a transient download failure (matches the GraphQL client's spirit). */
export const BULK_DOWNLOAD_MAX_ATTEMPTS = 4;

export { reassembleOrders, parseBulkJsonl } from "@inventory/s-ingest-core";

export interface BulkOperation {
  id: string;
  status: string; // CREATED | RUNNING | COMPLETED | FAILED | CANCELED | ...
  errorCode?: string | null;
  objectCount?: string | null;
  url?: string | null;
  partialDataUrl?: string | null;
}

export async function startOrdersBackfill(client: ShopifyClient, cutoverIso: string): Promise<BulkOperation> {
  const data = await client.request<{
    bulkOperationRunQuery: { bulkOperation: BulkOperation | null; userErrors: { field: string[]; message: string }[] };
  }>(BULK_OPERATION_RUN_MUTATION, { query: buildOrdersBulkQuery(cutoverIso) });

  const { bulkOperation, userErrors } = data.bulkOperationRunQuery;
  if (userErrors.length > 0) {
    throw new Error(`bulkOperationRunQuery failed: ${userErrors.map((e) => e.message).join("; ")}`);
  }
  if (!bulkOperation) throw new Error("bulkOperationRunQuery returned no operation");
  return bulkOperation;
}

export async function getCurrentBulkOperation(client: ShopifyClient): Promise<BulkOperation | null> {
  const data = await client.request<{ currentBulkOperation: BulkOperation | null }>(CURRENT_BULK_OPERATION_QUERY);
  return data.currentBulkOperation;
}

/**
 * Download the raw JSONL result verbatim. Reassembly + durable capture happen in
 * ingestBulkOrders.
 *
 * Hardened with a hard per-attempt deadline (AbortSignal) so a hung GCS connection fails
 * fast instead of running the whole invocation into the Lambda timeout (which would leave a
 * dangling RUNNING sync_run), plus bounded backoff retries on a transient failure (timeout,
 * network, 429/5xx). A non-retryable status (e.g. 403 on an expired signed URL) throws at
 * once. `backoffMs` is injectable so tests don't sleep.
 */
export async function downloadBulkJsonl(
  url: string,
  opts: { timeoutMs?: number; maxAttempts?: number; backoffMs?: (attempt: number) => number } = {},
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? BULK_DOWNLOAD_TIMEOUT_MS;
  const maxAttempts = opts.maxAttempts ?? BULK_DOWNLOAD_MAX_ATTEMPTS;
  const backoffMs = opts.backoffMs ?? jitteredBackoffMs;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const transient = res.status === 429 || res.status >= 500;
        if (transient && attempt < maxAttempts) {
          logger.warn("bulk download retry (transport)", { attempt, status: res.status });
          await sleep(backoffMs(attempt));
          continue;
        }
        throw new Error(`Failed to download bulk result: HTTP ${res.status}`);
      }
      return await res.text();
    } catch (err) {
      // A decided non-retryable HTTP status was already thrown above — let it propagate.
      if (err instanceof Error && err.message.startsWith("Failed to download bulk result: HTTP")) throw err;
      // Otherwise (abort/timeout, network error): retry until the attempt budget is spent.
      if (attempt >= maxAttempts) throw err;
      logger.warn("bulk download retry (timeout/network)", { attempt, err: err instanceof Error ? err.message : String(err) });
      await sleep(backoffMs(attempt));
    } finally {
      clearTimeout(timer);
    }
  }
}
