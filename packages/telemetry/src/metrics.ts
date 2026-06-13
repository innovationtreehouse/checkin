/**
 * CloudWatch metric emission — the frozen metric contract for the monitoring fleet.
 *
 * Metrics are emitted via the **Embedded Metric Format (EMF)**: we write one specially
 * shaped JSON line to stdout and CloudWatch Logs extracts the metric automatically. This
 * avoids the `PutMetricData` API entirely — no extra IAM, no per-request cost, and it
 * still works when the only thing the Lambda can reach is its own log stream.
 *
 * THE CONTRACT (do not drift — the CloudWatch alarms key off these exact strings):
 *   namespace : "Inventory/Monitoring"
 *   dimensions: { service, env }   — and ONLY these (no free text in a metric)
 *   metrics   : serviceError | dbUnreachable | monitorHeartbeat
 *
 * The metric is a generic *signal*; the rich "what went wrong" detail lives in the
 * `health_event` table, never inside a metric. See MONITORING-PRD.md §4.2.
 *
 * Alarm semantics that pair with each metric (documented in the function READMEs):
 *   serviceError      missing data = NOT breaching (a healthy service emits nothing).
 *   dbUnreachable     missing data = NOT breaching.
 *   monitorHeartbeat  missing data = BREACHING — this is the floor: a dead monitor
 *                     emits nothing, so its liveness is asserted by absence detection.
 */

export const METRIC_NAMESPACE = "Inventory/Monitoring";

export const MetricName = {
  /** A monitored service is unhealthy (stale / erroring). Why → health_event. */
  serviceError: "serviceError",
  /** A monitor could not reach a database while doing its job. */
  dbUnreachable: "dbUnreachable",
  /** Liveness ping from a monitor (watchdog/relay). Alarm on MISSING data. */
  monitorHeartbeat: "monitorHeartbeat",
} as const;

export type MetricName = (typeof MetricName)[keyof typeof MetricName];

/** The only dimensions a monitoring metric may carry. */
export interface MetricDimensions {
  /** The pipeline/Lambda the signal is about (e.g. "shopify-read"), or the monitor's own name for heartbeats. */
  service: string;
  /** Deployment environment (e.g. "prod", "staging"). */
  env: string;
}

/**
 * Emit one metric as an EMF log line on stdout. `value` defaults to 1 (a count/flag).
 * Extra non-dimension fields can be attached for log-side debugging — they are NOT part
 * of the metric and won't increase metric cardinality. `extra` is spread *first*, so it
 * can never override the reserved contract keys (`_aws`, `service`, `env`, the metric
 * value): a stray `extra.service` corrupts neither the dimension nor the alarm.
 */
export function emitMetric(
  name: MetricName,
  dims: MetricDimensions,
  value = 1,
  extra?: Record<string, unknown>,
): void {
  const line = {
    ...extra,
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: METRIC_NAMESPACE,
          Dimensions: [["service", "env"]],
          Metrics: [{ Name: name, Unit: "Count" }],
        },
      ],
    },
    service: dims.service,
    env: dims.env,
    [name]: value,
  };
  // stdout → CloudWatch Logs → EMF extraction. console.log keeps it on the happy path
  // even when nothing else (DB, network) is reachable.
  console.log(JSON.stringify(line));
}

/** A monitored service is unhealthy. Pair with `recordIncident` for the detail. */
export function emitServiceError(service: string, env: string, extra?: Record<string, unknown>): void {
  emitMetric(MetricName.serviceError, { service, env }, 1, extra);
}

/** A monitor hit a DB it could not reach. `service` is the DB/service it was probing. */
export function emitDbUnreachable(service: string, env: string, extra?: Record<string, unknown>): void {
  emitMetric(MetricName.dbUnreachable, { service, env }, 1, extra);
}

/**
 * Liveness ping for a monitor. `monitorName` is the monitor itself (e.g.
 * "monitoring-watchdog"), which becomes the `service` dimension so CloudWatch can run a
 * per-monitor missing-data alarm.
 */
export function emitMonitorHeartbeat(monitorName: string, env: string): void {
  emitMetric(MetricName.monitorHeartbeat, { service: monitorName, env }, 1);
}
