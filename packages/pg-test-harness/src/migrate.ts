/**
 * Applies a package's committed Prisma migrations to a fresh database.
 *
 * Uses `prisma migrate deploy` (NOT `db push`) so the test schema is byte-for-byte the
 * one the migrations produce in production — drift between "what the tests run on" and
 * "what deploy applies" becomes impossible.
 *
 * Prisma 7 has no `url` in the datasource block; the CLI reads it from each package's
 * `prisma.config.ts`, which in turn reads `process.env[<domain var>]`. So we just point
 * that var at the container for the child process — no schema edits, no extra config.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

export interface ApplyMigrationsOptions {
  /** Dir holding the package's `prisma.config.ts` + `prisma/migrations` (the CLI cwd). */
  migrateCwd: string;
  /** The domain URL var the package's `prisma.config.ts` reads (e.g. SHOPIFY_READ_DATABASE_URL). */
  envVar: string;
  /** Connection string for the freshly-started container. */
  url: string;
}

/** Resolve the Prisma CLI entrypoint as seen from the migrating package (handles hoisting). */
function resolvePrismaBin(migrateCwd: string): string {
  const requireFrom = createRequire(resolve(migrateCwd, "package.json"));
  const pkgJsonPath = requireFrom.resolve("prisma/package.json");
  const pkg = requireFrom("prisma/package.json") as { bin: string | Record<string, string> };
  const binRel = typeof pkg.bin === "string" ? pkg.bin : pkg.bin.prisma;
  return resolve(dirname(pkgJsonPath), binRel);
}

export function applyMigrations({ migrateCwd, envVar, url }: ApplyMigrationsOptions): void {
  const bin = resolvePrismaBin(migrateCwd);
  execFileSync(process.execPath, [bin, "migrate", "deploy"], {
    cwd: migrateCwd,
    env: { ...process.env, [envVar]: url },
    stdio: "inherit",
  });
}
