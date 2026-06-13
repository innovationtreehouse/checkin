import { describe, it, expect } from "vitest";
import { evaluateFreshness, evaluateErroring } from "./watchdog.js";

const NOW = new Date("2026-06-09T12:00:00Z").getTime();

describe("evaluateFreshness", () => {
  it("treats a never-completed service as stale with null age", () => {
    expect(evaluateFreshness(null, 7200, NOW)).toEqual({ stale: true, ageSeconds: null });
  });

  it("is healthy when the last run is within the window", () => {
    const last = new Date(NOW - 1000 * 1000); // 1000s ago
    expect(evaluateFreshness(last, 7200, NOW)).toEqual({ stale: false, ageSeconds: 1000 });
  });

  it("is stale when the last run is older than the window", () => {
    const last = new Date(NOW - 8000 * 1000); // 8000s ago
    expect(evaluateFreshness(last, 7200, NOW)).toEqual({ stale: true, ageSeconds: 8000 });
  });

  it("is healthy exactly at the threshold (strictly greater = stale)", () => {
    const last = new Date(NOW - 7200 * 1000);
    expect(evaluateFreshness(last, 7200, NOW)).toEqual({ stale: false, ageSeconds: 7200 });
  });

  it("clamps a future lastFinishedAt (clock skew) to age 0 and flags it, never silently fresh", () => {
    const future = new Date(NOW + 500 * 1000); // 500s in the future
    expect(evaluateFreshness(future, 7200, NOW)).toEqual({ stale: false, ageSeconds: 0, clockSkew: true });
  });
});

describe("evaluateErroring", () => {
  const lastSuccess = new Date(NOW - 1000 * 1000); // 1000s ago

  it("is not erroring when there is no failure on record", () => {
    expect(evaluateErroring(lastSuccess, null)).toEqual({ erroring: false, failedAt: null, error: null });
  });

  it("is erroring when the latest failure is newer than the last success", () => {
    const failedAt = new Date(NOW - 500 * 1000); // 500s ago, after the success
    expect(evaluateErroring(lastSuccess, { failedAt, error: "boom" })).toEqual({
      erroring: true,
      failedAt,
      error: "boom",
    });
  });

  it("is not erroring when the failure predates the last success (already recovered)", () => {
    const failedAt = new Date(NOW - 2000 * 1000); // 2000s ago, before the success
    expect(evaluateErroring(lastSuccess, { failedAt, error: "old" })).toEqual({
      erroring: false,
      failedAt: null,
      error: null,
    });
  });

  it("defers to the staleness check when the service has never completed a run", () => {
    const failedAt = new Date(NOW - 100 * 1000);
    expect(evaluateErroring(null, { failedAt, error: "boom" })).toEqual({
      erroring: false,
      failedAt: null,
      error: null,
    });
  });
});
