/**
 * Shared scaffolding for the DB-gated integration tier.
 *
 * Every integration suite is wrapped in {@link runIfDb}, which is `describe` only when
 * MONITORING_DATABASE_URL is set and `describe.skip` otherwise — so `npm test` stays green
 * on a machine with no Postgres while the same files run for real in CI / against a local
 * DB. Each client pins a single pg connection (`max: 1`, the documented prod config) so
 * advisory acquire/release and the like land on one session. Mirrors the convention in
 * `packages/s-ingest-core/test/integration`.
 */
import { describe } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma/client.js";

export const runIfDb = process.env.MONITORING_DATABASE_URL ? describe : describe.skip;

/** A PrismaClient pinned to a single pg connection (one DB session). */
export function singleConnClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.MONITORING_DATABASE_URL as string, max: 1 });
  return new PrismaClient({ adapter });
}

/** Truncate all three tables, FK-safe (outbox references health_event). */
export async function resetTables(prisma: PrismaClient): Promise<void> {
  await prisma.outbox.deleteMany({});
  await prisma.healthEvent.deleteMany({});
  await prisma.serviceHeartbeat.deleteMany({});
}
