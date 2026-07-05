import { describe, it, expect, vi, afterEach } from "vitest";
import {
  emitMetric,
  emitServiceError,
  emitDbUnreachable,
  emitMonitorHeartbeat,
  MetricName,
  METRIC_NAMESPACE,
} from "./index.js";

/**
 * Spies on console.log and parses back every line the code under test wrote.
 * Restoration is handled centrally by `afterEach` — callers never restore by hand,
 * so a throwing assertion can't leave console mocked for the next test.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function capture(): () => Array<Record<string, any>> {
  const spy = vi.spyOn(console, "log").mockImplementation(() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return () => spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, any>);
}

afterEach(() => vi.restoreAllMocks());

describe("emitMetric — core EMF shape (contract)", () => {
  it("writes exactly one line, and that line is valid JSON", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "shopify-read", env: "prod" });
    expect(lines()).toHaveLength(1);
  });

  it("emits the frozen namespace, single Count metric, and only service/env dimensions", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "shopify-read", env: "prod" });
    const [line] = lines();

    const cwm = line._aws.CloudWatchMetrics[0];
    expect(cwm.Namespace).toBe(METRIC_NAMESPACE);
    expect(cwm.Dimensions).toEqual([["service", "env"]]);
    expect(cwm.Metrics).toEqual([{ Name: "serviceError", Unit: "Count" }]);
    expect(line.service).toBe("shopify-read");
    expect(line.env).toBe("prod");
    expect(line.serviceError).toBe(1);
  });

  it("stamps a numeric EMF Timestamp", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "s", env: "prod" });
    expect(typeof lines()[0]._aws.Timestamp).toBe("number");
  });

  it("defaults value to 1 when omitted", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "s", env: "prod" });
    expect(lines()[0].serviceError).toBe(1);
  });

  it("honours an explicit value override", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "s", env: "prod" }, 7);
    expect(lines()[0].serviceError).toBe(7);
  });

  it("preserves an explicit value of 0 (a real datapoint, not a falsy default)", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "s", env: "prod" }, 0);
    const [line] = lines();
    expect(line).toHaveProperty("serviceError", 0);
    expect(line.serviceError).toBe(0);
  });
});

describe("emitMetric — extra fields", () => {
  it("attaches extra fields to the log line", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "s", env: "prod" }, 1, {
      correlationId: "abc-123",
      attempt: 2,
    });
    const [line] = lines();
    expect(line.correlationId).toBe("abc-123");
    expect(line.attempt).toBe(2);
  });

  it("does NOT promote extra fields to metric dimensions (no cardinality blowup)", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "s", env: "prod" }, 1, { region: "us-east-1" });
    expect(lines()[0]._aws.CloudWatchMetrics[0].Dimensions).toEqual([["service", "env"]]);
  });

  it("never lets extra clobber the reserved contract keys", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "shopify-read", env: "prod" }, 1, {
      service: "spoofed",
      env: "spoofed",
      serviceError: 999,
      _aws: "spoofed",
    });
    const [line] = lines();
    expect(line.service).toBe("shopify-read");
    expect(line.env).toBe("prod");
    expect(line.serviceError).toBe(1);
    expect(line._aws.CloudWatchMetrics[0].Namespace).toBe(METRIC_NAMESPACE);
  });

  it("tolerates undefined extra", () => {
    const lines = capture();
    expect(() => emitMetric(MetricName.serviceError, { service: "s", env: "prod" }, 1, undefined)).not.toThrow();
    expect(lines()).toHaveLength(1);
  });
});

describe("emitMetric — edge inputs", () => {
  it("emits even with empty service/env strings (no throw, values pass through verbatim)", () => {
    const lines = capture();
    emitMetric(MetricName.serviceError, { service: "", env: "" });
    const [line] = lines();
    expect(line.service).toBe("");
    expect(line.env).toBe("");
    expect(line._aws.CloudWatchMetrics[0].Dimensions).toEqual([["service", "env"]]);
  });
});

describe("convenience emitters", () => {
  it("emitServiceError → serviceError metric on the given service/env", () => {
    const lines = capture();
    emitServiceError("shopify-read", "prod");
    const [line] = lines();
    expect(line._aws.CloudWatchMetrics[0].Metrics[0].Name).toBe("serviceError");
    expect(line.service).toBe("shopify-read");
    expect(line.env).toBe("prod");
    expect(line.serviceError).toBe(1);
  });

  it("emitServiceError forwards extra fields", () => {
    const lines = capture();
    emitServiceError("shopify-read", "prod", { staleBySec: 900 });
    expect(lines()[0].staleBySec).toBe(900);
  });

  it("emitDbUnreachable → dbUnreachable metric on the probed service/env", () => {
    const lines = capture();
    emitDbUnreachable("monitoring-db", "staging");
    const [line] = lines();
    expect(line._aws.CloudWatchMetrics[0].Metrics[0].Name).toBe("dbUnreachable");
    expect(line.service).toBe("monitoring-db");
    expect(line.env).toBe("staging");
    expect(line.dbUnreachable).toBe(1);
  });

  it("emitDbUnreachable forwards extra fields", () => {
    const lines = capture();
    emitDbUnreachable("monitoring-db", "staging", { err: "ETIMEDOUT" });
    expect(lines()[0].err).toBe("ETIMEDOUT");
  });

  it("emitMonitorHeartbeat uses the monitor name as the service dimension", () => {
    const lines = capture();
    emitMonitorHeartbeat("monitoring-watchdog", "prod");
    const [line] = lines();
    expect(line._aws.CloudWatchMetrics[0].Namespace).toBe(METRIC_NAMESPACE);
    expect(line._aws.CloudWatchMetrics[0].Metrics[0].Name).toBe("monitorHeartbeat");
    expect(line.service).toBe("monitoring-watchdog");
    expect(line.env).toBe("prod");
    expect(line.monitorHeartbeat).toBe(1);
  });
});
