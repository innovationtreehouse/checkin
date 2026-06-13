/**
 * The local `run:once` entry point. cli.ts has a top-level side effect (it invokes the
 * handler on import), so each case sets up the handler mock, then dynamically imports the
 * module under a fresh registry and flushes the floating then/catch chain before asserting.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./handler.js", () => ({ handler: h.handler }));

let exitSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let errSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

/** Import cli.ts fresh (so its top-level run fires) and let the handler promise settle. */
async function runCli(): Promise<void> {
  vi.resetModules();
  await import("./cli.js");
  await new Promise((r) => setImmediate(r));
}

describe("cli (run:once)", () => {
  it("on success logs the watchdog result with ok:true and exits 0", async () => {
    h.handler.mockResolvedValue({ checked: 2, incidents: 1 });

    await runCli();

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({ ok: true, checked: 2, incidents: 1 }));
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(errSpy).not.toHaveBeenCalled();
  });

  it("on failure logs the error to stderr and exits 1", async () => {
    const boom = new Error("monitoring DB unreachable");
    h.handler.mockRejectedValue(boom);

    await runCli();

    expect(errSpy).toHaveBeenCalledWith(boom);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(logSpy).not.toHaveBeenCalled();
  });
});
