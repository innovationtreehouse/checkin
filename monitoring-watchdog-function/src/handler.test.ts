import { describe, it, expect, vi, beforeEach } from "vitest";

// The handler is a thin seam: load config → run the watchdog → return its result.
// Stub both so this stays a wiring smoke test, not a re-test of watchdog/registry.
const cfg = {
  env: "prod",
  monitorName: "monitoring-watchdog",
  renotifyAfterSeconds: 3600,
  services: [{ service: "shopify-read", staleAfterSeconds: 7200 }],
};

vi.mock("./registry.js", () => ({ loadWatchdogConfig: vi.fn(() => cfg) }));
vi.mock("./watchdog.js", () => ({ runWatchdog: vi.fn(async () => ({ checked: 1, incidents: 0 })) }));

import { handler } from "./handler.js";
import { loadWatchdogConfig } from "./registry.js";
import { runWatchdog } from "./watchdog.js";

beforeEach(() => vi.clearAllMocks());

describe("handler", () => {
  it("loads config, runs the watchdog with it, and returns the watchdog result", async () => {
    const result = await handler();

    expect(loadWatchdogConfig).toHaveBeenCalledOnce();
    expect(runWatchdog).toHaveBeenCalledWith(cfg);
    expect(result).toEqual({ checked: 1, incidents: 0 });
  });

  it("surfaces a watchdog failure (e.g. monitoring DB unreachable) to the caller", async () => {
    vi.mocked(runWatchdog).mockRejectedValueOnce(new Error("connection refused"));

    await expect(handler()).rejects.toThrow("connection refused");
  });
});
