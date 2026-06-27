/**
 * applyMigrations shells out to the Prisma CLI (`migrate deploy`) with the container URL
 * injected into the child's env. We mock the child_process + module boundary so the CLI
 * resolution and the exact spawn contract are asserted without a real Prisma project or
 * database. Covers both the string and object forms of prisma's package.json `bin`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));
const { createRequire } = vi.hoisted(() => ({ createRequire: vi.fn() }));

vi.mock("node:child_process", () => ({ execFileSync }));
vi.mock("node:module", () => ({ createRequire }));

import { applyMigrations } from "./migrate.js";

/** A fake `require` whose `.resolve` points at a prisma package.json and which returns the
 *  given `bin` field when asked for prisma/package.json. */
function fakeRequire(binField: string | Record<string, string>) {
  const req = ((_id: string) => ({ bin: binField })) as unknown as NodeJS.Require;
  (req as unknown as { resolve: () => string }).resolve = () => "/repo/node_modules/prisma/package.json";
  return req;
}

beforeEach(() => vi.clearAllMocks());

describe("applyMigrations", () => {
  it("resolves the prisma CLI and runs `migrate deploy` with the URL injected into the child env", () => {
    createRequire.mockReturnValue(fakeRequire("build/index.js"));

    applyMigrations({ migrateCwd: "/repo/packages/x", envVar: "X_DATABASE_URL", url: "postgres://container" });

    expect(execFileSync).toHaveBeenCalledTimes(1);
    const [bin, args, opts] = execFileSync.mock.calls[0] as [string, string[], { cwd: string; env: NodeJS.ProcessEnv; stdio: string }];
    expect(bin).toBe(process.execPath);
    expect(args[0]).toBe("/repo/node_modules/prisma/build/index.js"); // dirname(pkgJson) + bin
    expect(args.slice(1)).toEqual(["migrate", "deploy"]);
    expect(opts.cwd).toBe("/repo/packages/x");
    expect(opts.env.X_DATABASE_URL).toBe("postgres://container");
    expect(opts.stdio).toBe("inherit");
  });

  it("handles the object form of prisma's `bin` field (`{ prisma: '...' }`)", () => {
    createRequire.mockReturnValue(fakeRequire({ prisma: "cli.js" }));

    applyMigrations({ migrateCwd: "/repo/p", envVar: "Y_URL", url: "u" });

    const args = execFileSync.mock.calls[0][1] as string[];
    expect(args[0]).toBe("/repo/node_modules/prisma/cli.js");
  });

  it("preserves the rest of the parent environment alongside the injected URL", () => {
    createRequire.mockReturnValue(fakeRequire("b.js"));
    process.env.PG_HARNESS_SENTINEL = "keep-me";

    applyMigrations({ migrateCwd: "/p", envVar: "Z_URL", url: "u" });

    const opts = execFileSync.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(opts.env.PG_HARNESS_SENTINEL).toBe("keep-me");
    expect(opts.env.Z_URL).toBe("u");
    delete process.env.PG_HARNESS_SENTINEL;
  });
});
