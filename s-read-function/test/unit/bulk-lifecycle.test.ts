/**
 * The Shopify bulk-operation lifecycle calls in bulk.ts: starting an export
 * (success, userErrors, and the no-operation response), reading the current op, and
 * downloading the JSONL (success + HTTP error). reassembly itself is covered in
 * bulk-reassemble.test.ts.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { startOrdersBackfill, getCurrentBulkOperation, downloadBulkJsonl } from "../../src/shopify/bulk.js";
import { fakeClient } from "../helpers/fakeClient.js";

afterEach(() => vi.unstubAllGlobals());

describe("startOrdersBackfill", () => {
  it("returns the bulk operation and forwards the cutover-scoped query", async () => {
    const client = fakeClient({ bulkOperationRunQuery: { bulkOperation: { id: "gid://op/1", status: "CREATED" }, userErrors: [] } });
    const op = await startOrdersBackfill(client, "2026-01-01T00:00:00.000Z");

    expect(op).toEqual({ id: "gid://op/1", status: "CREATED" });
    expect(client.calls[0].variables.query).toContain("2026-01-01T00:00:00.000Z");
  });

  it("throws when Shopify returns userErrors", async () => {
    const client = fakeClient({
      bulkOperationRunQuery: { bulkOperation: null, userErrors: [{ field: ["query"], message: "A bulk query is already running" }] },
    });
    await expect(startOrdersBackfill(client, "2026-01-01")).rejects.toThrow("A bulk query is already running");
  });

  it("throws when no operation is returned and there are no userErrors", async () => {
    const client = fakeClient({ bulkOperationRunQuery: { bulkOperation: null, userErrors: [] } });
    await expect(startOrdersBackfill(client, "2026-01-01")).rejects.toThrow("returned no operation");
  });
});

describe("getCurrentBulkOperation", () => {
  it("returns the current operation, or null when there is none", async () => {
    expect(await getCurrentBulkOperation(fakeClient({ currentBulkOperation: { id: "gid://op/9", status: "RUNNING" } }))).toEqual({
      id: "gid://op/9",
      status: "RUNNING",
    });
    expect(await getCurrentBulkOperation(fakeClient({ currentBulkOperation: null }))).toBeNull();
  });
});

describe("downloadBulkJsonl", () => {
  it("returns the body text on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "line1\nline2\n" }));
    expect(await downloadBulkJsonl("https://bulk/result.jsonl")).toBe("line1\nline2\n");
  });

  it("throws immediately on a non-retryable status (403 expired signed URL), no retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);
    await expect(downloadBulkJsonl("https://bulk/result.jsonl", { backoffMs: () => 0 })).rejects.toThrow("HTTP 403");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a transient 5xx then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "ok\n" });
    vi.stubGlobal("fetch", fetchMock);

    expect(await downloadBulkJsonl("https://bulk/r.jsonl", { backoffMs: () => 0 })).toBe("ok\n");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries an abort/timeout (AbortError) then succeeds", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abort)
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => "late\n" });
    vi.stubGlobal("fetch", fetchMock);

    expect(await downloadBulkJsonl("https://bulk/r.jsonl", { backoffMs: () => 0 })).toBe("late\n");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts on a persistent transient failure", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "" });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadBulkJsonl("https://bulk/r.jsonl", { maxAttempts: 3, backoffMs: () => 0 }),
    ).rejects.toThrow("HTTP 500");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("aborts a hung download after timeoutMs (the AbortController actually fires)", async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      // A fetch that never resolves on its own — only settles when the timeout aborts it.
      const fetchMock = vi.fn((_url: string, opts: { signal: AbortSignal }) => {
        signal = opts.signal;
        return new Promise((_res, rej) => {
          opts.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      });
      vi.stubGlobal("fetch", fetchMock);

      const p = downloadBulkJsonl("https://bulk/r.jsonl", { timeoutMs: 1_000, maxAttempts: 1, backoffMs: () => 0 });
      const rejects = expect(p).rejects.toThrow(/abort/i);
      await vi.advanceTimersByTimeAsync(1_000);
      await rejects;

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
