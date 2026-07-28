/**
 * Logging for the Shopify ingest core.
 *
 * The implementation now lives in the fleet-wide @inventory/telemetry package so every
 * service logs in the same shape; this module just re-exports it. Kept as a stable
 * import path (`./logger.js`) so existing callers in s-ingest-core / s-read / s-replay
 * are unchanged.
 */
export { logger, newCorrelationId } from "@inventory/telemetry";
export type { Fields } from "@inventory/telemetry";
