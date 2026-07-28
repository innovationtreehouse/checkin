/**
 * PrismaClient singleton for the monitoring database.
 *
 * Held at module scope so a warm Lambda invocation reuses the same client (and its
 * connection) instead of opening a new pool each call. In production the
 * MONITORING_DATABASE_URL should route through RDS Proxy / pgBouncer with
 * `?pgbouncer=true&connection_limit=1`.
 *
 * Prisma 7 is Rust-free: the client no longer reads `datasource.url` itself and instead
 * connects through a driver adapter. We pass @prisma/adapter-pg (node-postgres). Note the
 * v7 behaviour changes that ride along: the pool uses pg's defaults (no statement/connect
 * timeout, unlike Prisma v6's 5s) and invalid TLS certs are no longer silently ignored —
 * both are governed by MONITORING_DATABASE_URL params.
 *
 * Construction is **lazy**: the URL is read and the client built on first use, not at
 * import. This lets test harnesses set the URL after this module loads, and means importing
 * the package never throws merely because a URL is absent. The env-read wiring itself is
 * guarded against drift by `src/db/client.construction.test.ts`.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

declare global {

  var __monitoringPrisma: PrismaClient | undefined;
}

/**
 * Get the shared client, constructing it on first call. Pass an explicit `connectionString`
 * to build against a specific database (used by integration tests); otherwise the dedicated
 * MONITORING_DATABASE_URL is read. Memoized on `globalThis`, so the first caller wins.
 */
export function getPrisma(
  connectionString: string | undefined = process.env.MONITORING_DATABASE_URL,
): PrismaClient {
  if (globalThis.__monitoringPrisma) return globalThis.__monitoringPrisma;
  if (!connectionString) {
    throw new Error(
      "MONITORING_DATABASE_URL is not set (and no connection string was passed to getPrisma()); " +
        "the Prisma client cannot be constructed without a database URL.",
    );
  }
  const adapter = new PrismaPg({ connectionString });
  const client = new PrismaClient({ adapter });
  globalThis.__monitoringPrisma = client;
  return client;
}

/**
 * Lazy singleton: every property access resolves through {@link getPrisma}, so the client
 * is built on first real use rather than at import. Existing `prisma.*` call sites keep
 * working unchanged.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

export type { PrismaClient };
