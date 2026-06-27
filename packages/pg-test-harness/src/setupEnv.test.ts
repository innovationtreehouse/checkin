/**
 * applyHarnessEnv is the worker-side bridge: it reads the container URL the globalSetup
 * `provide`d (via vitest's `inject`) and publishes it to process.env[envVar] — but only when
 * that var is not already set, so a developer pointing at their own Postgres always wins.
 *
 * Rather than mock the vitest module (fragile), we drive the real `inject` channel: the
 * vitest config statically `provide`s `pgHarnessProvidedUrl`, exactly as globalSetup would at
 * runtime. An unprovided key reads back as undefined — the same shape as the no-Docker path.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applyHarnessEnv } from "./setupEnv.js";

const VAR = "PG_HARNESS_TEST_URL";
const PROVIDED = "pgHarnessProvidedUrl"; // matches vitest.config.ts `provide`
const URL = "postgres://from-harness";

describe("applyHarnessEnv", () => {
  beforeEach(() => delete process.env[VAR]);
  afterEach(() => delete process.env[VAR]);

  it("publishes the provided url to the env var when it is unset", () => {
    applyHarnessEnv({ envVar: VAR, provideKey: PROVIDED });
    expect(process.env[VAR]).toBe(URL);
  });

  it("leaves an already-set env var untouched (an explicit developer target wins)", () => {
    process.env[VAR] = "postgres://developer-choice";
    applyHarnessEnv({ envVar: VAR, provideKey: PROVIDED });
    expect(process.env[VAR]).toBe("postgres://developer-choice");
  });

  it("does nothing when the harness provided no url (key absent → undefined, the Docker-absent path)", () => {
    applyHarnessEnv({ envVar: VAR, provideKey: "pgHarnessUnprovidedKey" });
    expect(process.env[VAR]).toBeUndefined();
  });
});
