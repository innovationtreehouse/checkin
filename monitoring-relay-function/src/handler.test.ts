import { describe, it, expect, vi, beforeEach } from "vitest";

// The handler is a thin seam: load config → run the relay → return its result.
// Stub both so this stays a wiring smoke test, not a re-test of relay/config.
const cfg = {
  snsTopicArn: "arn:aws:sns:us-east-1:123456789012:monitoring-alerts",
  env: "prod",
  monitorName: "monitoring-relay",
  batchLimit: 50,
};

vi.mock("./config.js", () => ({ loadRelayConfig: vi.fn(() => cfg) }));
vi.mock("./relay.js", () => ({ runRelay: vi.fn(async () => ({ delivered: 3, failed: 0 })) }));

import { handler } from "./handler.js";
import { loadRelayConfig } from "./config.js";
import { runRelay } from "./relay.js";

beforeEach(() => vi.clearAllMocks());

describe("handler", () => {
  it("loads config, runs the relay with it, and returns the relay result", async () => {
    const result = await handler();

    expect(loadRelayConfig).toHaveBeenCalledOnce();
    expect(runRelay).toHaveBeenCalledWith(cfg);
    expect(result).toEqual({ delivered: 3, failed: 0 });
  });

  it("surfaces a relay failure (e.g. monitoring DB unreachable) to the caller", async () => {
    vi.mocked(runRelay).mockRejectedValueOnce(new Error("connection refused"));

    await expect(handler()).rejects.toThrow("connection refused");
  });
});
