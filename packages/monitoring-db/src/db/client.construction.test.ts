/**
 * Drift guard for the runtime client's env-read wiring.
 *
 * The integration tier builds clients explicitly (DI) and never exercises the production
 * `getPrisma()` env-read path — so without this test, renaming MONITORING_DATABASE_URL or
 * breaking the adapter wiring would sail through green. This pins, with no database:
 *   - the exact env var name is read and handed to the pg adapter,
 *   - an explicit connection string overrides the env var,
 *   - a missing URL fails loudly instead of constructing a broken client,
 *   - nothing is constructed at import (the singleton is lazy).
 *
 * The adapter + generated client are mocked, so this asserts construction args without
 * opening a connection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const adapterArgs: Array<{ connectionString?: string }> = [];

vi.mock("@prisma/adapter-pg", () => ({
  PrismaPg: class {
    constructor(opts: { connectionString?: string }) {
      adapterArgs.push(opts);
    }
  },
}));

vi.mock("../generated/prisma/client.js", () => ({
  PrismaClient: class {
    constructor(public opts: unknown) {}
  },
}));

const ENV = "MONITORING_DATABASE_URL";
const CLIENT = "./client.js";
let saved: string | undefined;

beforeEach(() => {
  saved = process.env[ENV];
  adapterArgs.length = 0;
  delete (globalThis as Record<string, unknown>).__monitoringPrisma;
  vi.resetModules();
});

afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

describe("getPrisma construction (env-read wiring)", () => {
  it("reads MONITORING_DATABASE_URL and hands it to the pg adapter", async () => {
    process.env[ENV] = "postgresql://sentinel-host/db";
    const { getPrisma } = await import(CLIENT);
    getPrisma();
    expect(adapterArgs).toEqual([{ connectionString: "postgresql://sentinel-host/db" }]);
  });

  it("throws a clear error when the var is unset and no url is passed", async () => {
    delete process.env[ENV];
    const { getPrisma } = await import(CLIENT);
    expect(() => getPrisma()).toThrow(/MONITORING_DATABASE_URL/);
  });

  it("prefers an explicit connection string over the env var", async () => {
    process.env[ENV] = "postgresql://env-host/db";
    const { getPrisma } = await import(CLIENT);
    getPrisma("postgresql://explicit-host/db");
    expect(adapterArgs).toEqual([{ connectionString: "postgresql://explicit-host/db" }]);
  });

  it("constructs nothing at import time (lazy singleton)", async () => {
    process.env[ENV] = "postgresql://not-read-until-first-use/db";
    await import(CLIENT);
    expect(adapterArgs).toEqual([]);
  });
});
