/**
 * Append-only writer for `shopify_raw_event`.
 *
 * Rows are never updated or deleted. As a bloat guard we skip the insert when the
 * incoming payload is byte-identical to the most recent event already logged for
 * the same (store, objectType, gid) — a no-op re-read adds nothing. Anything that
 * differs (including a revert to an earlier payload) is always appended.
 *
 * The "identical to latest" check and the insert run in ONE transaction guarded by a
 * per-gid Postgres advisory lock, so two concurrent ingests of the same gid cannot both
 * pass the check and double-append. The fleet targets reserved-concurrency = 1, but the
 * raw log is the system of record for replay, so this guarantee is enforced in the DB
 * rather than assumed from deployment config.
 */
import crypto from "node:crypto";
import type { Prisma } from "../generated/prisma/client.js";
import { EventSource, ObjectType } from "../generated/prisma/client.js";
import type { PrismaClient } from "../db/client.js";
import { rawMetaForNode } from "../shopify/schemas.js";

export type DbClient = Prisma.TransactionClient;

export interface AppendRawEventArgs {
  storeId: string;
  objectType: ObjectType;
  /** The Shopify node (or fixture node). Validated to extract log metadata. */
  node: unknown;
  source: EventSource;
  syncRunId?: bigint | null;
}

export interface AppendRawEventResult {
  rawEventId: bigint;
  shopifyGid: string;
  /** The node's own timestamp (updatedAt / issuedAt / transactionDate), for watermarks. */
  occurredAt: Date | null;
  /** false when skipped as an identical re-read of the latest event for this gid. */
  inserted: boolean;
}

function hashPayload(node: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(node)).digest("hex");
}

export async function appendRawEvent(
  prisma: PrismaClient,
  args: AppendRawEventArgs,
): Promise<AppendRawEventResult> {
  const meta = rawMetaForNode(args.objectType, args.node);
  const payloadHash = hashPayload(args.node);

  return prisma.$transaction(async (tx) => {
    // Serialize concurrent appends for THIS (store, objectType, gid) so the dedup check
    // below and the insert are atomic. A transaction-scoped advisory lock auto-releases
    // on commit/rollback; occasional hash collisions on the key only over-serialize, never
    // under-serialize. (Lock keying preserves the "identical to latest" semantics exactly.)
    const lockKey = `raw_event:${args.storeId} ${args.objectType} ${meta.shopifyGid}`;
    // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, and Prisma 7's
    // Rust-free client cannot deserialize a `void` result column (the v6 query engine
    // tolerated it). We don't read a result here — we only need the lock acquired.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const latest = await tx.shopifyRawEvent.findFirst({
      where: { storeId: args.storeId, objectType: args.objectType, shopifyGid: meta.shopifyGid },
      orderBy: { id: "desc" },
      select: { id: true, payloadHash: true },
    });

    if (latest && latest.payloadHash === payloadHash) {
      return { rawEventId: latest.id, shopifyGid: meta.shopifyGid, occurredAt: meta.occurredAt, inserted: false };
    }

    const row = await tx.shopifyRawEvent.create({
      data: {
        storeId: args.storeId,
        objectType: args.objectType,
        shopifyGid: meta.shopifyGid,
        shopifyLegacyId: meta.shopifyLegacyId,
        occurredAt: meta.occurredAt,
        source: args.source,
        syncRunId: args.syncRunId ?? null,
        payload: args.node as Prisma.InputJsonValue,
        payloadHash,
      },
      select: { id: true },
    });

    return { rawEventId: row.id, shopifyGid: meta.shopifyGid, occurredAt: meta.occurredAt, inserted: true };
  });
}
