/**
 * Bulk-export reassembly + ingest for the orders backfill.
 *
 * Shopify Bulk Operations return JSONL: top-level orders plus their nested children. A
 * CONNECTION field (e.g. `lineItems`) is flattened into separate lines carrying `__parentId`,
 * while a non-connection LIST field (e.g. `refunds`) is returned INLINE on the order line.
 * `reassembleOrders` handles BOTH representations so no child is dropped regardless of which
 * shape Shopify uses for a given field.
 *
 * The full JSONL is persisted verbatim to `shopify_bulk_export` BEFORE reassembly, so a later
 * reassembly fix can re-derive the orders without re-pulling from Shopify (reingestBulkExports).
 */
import type { PrismaClient } from "../db/client.js";
import { EventSource, ObjectType } from "../generated/prisma/client.js";
import { legacyIdFromGid } from "../dates.js";
import type { OrderNode } from "../shopify/schemas.js";
import { ingestNode } from "./ingestNode.js";

/** Split a JSONL blob into parsed records, ignoring blank lines. */
export function parseBulkJsonl(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function childGid(child: unknown): string {
  return String((child as { id?: unknown } | null | undefined)?.id ?? "");
}

/** Pull inline child nodes from a connection-or-list value (`{nodes}` | `{edges:[{node}]}` | array). */
function inlineNodes(conn: unknown): unknown[] {
  if (!conn) return [];
  if (Array.isArray(conn)) return [...conn];
  const c = conn as { nodes?: unknown[] | null; edges?: { node: unknown }[] | null };
  if (Array.isArray(c.nodes)) return [...c.nodes];
  if (Array.isArray(c.edges)) return c.edges.map((e) => e.node);
  return [];
}

interface OrderAcc {
  order: Record<string, unknown>;
  lines: unknown[];
  refunds: unknown[];
  lineGids: Set<string>;
  refundGids: Set<string>;
}

/**
 * Reassemble flat JSONL records into nested order nodes. Children are seeded from any INLINE
 * values on the order, then any `__parentId` lines are appended — de-duped by child GID so a
 * field returned both inline and flattened is never double-counted.
 */
export function reassembleOrders(records: Record<string, unknown>[]): OrderNode[] {
  const orders = new Map<string, OrderAcc>();

  // Pass 1: collect top-level orders, seeding children from inline values.
  for (const rec of records) {
    const id = String(rec.id ?? "");
    if (rec.__parentId === undefined && id.includes("/Order/")) {
      const lines = inlineNodes(rec.lineItems);
      const refunds = inlineNodes(rec.refunds);
      orders.set(id, {
        order: rec,
        lines,
        refunds,
        lineGids: new Set(lines.map(childGid)),
        refundGids: new Set(refunds.map(childGid)),
      });
    }
  }

  // Pass 2: attach flattened children, skipping any already captured inline.
  for (const rec of records) {
    const parentId = rec.__parentId as string | undefined;
    if (!parentId) continue;
    const acc = orders.get(parentId);
    if (!acc) continue;
    const id = String(rec.id ?? "");
    if (id.includes("/LineItem/")) {
      if (!acc.lineGids.has(id)) {
        acc.lines.push(rec);
        acc.lineGids.add(id);
      }
    } else if (id.includes("/Refund/")) {
      if (!acc.refundGids.has(id)) {
        acc.refunds.push(rec);
        acc.refundGids.add(id);
      }
    }
    // Other child types are not part of the orders projection; ignored by design.
  }

  return Array.from(orders.values()).map((acc) => {
    const o: Record<string, unknown> = { ...acc.order, lineItems: { nodes: acc.lines }, refunds: acc.refunds };
    // legacyResourceId may be absent in bulk output — derive from the gid.
    if (o.legacyResourceId == null) o.legacyResourceId = legacyIdFromGid(String(o.id ?? ""));
    return o as OrderNode;
  });
}

export interface IngestBulkOrdersArgs {
  storeId: string;
  /** The verbatim JSONL body, exactly as downloaded from Shopify. */
  jsonl: string;
  bulkOperationId: string;
  source: EventSource;
  syncRunId?: bigint;
}

export interface IngestBulkOrdersResult {
  exportId: bigint;
  recordCount: number;
  ingested: number;
  maxOccurredAt: Date | null;
}

/**
 * Persist the verbatim JSONL to `shopify_bulk_export` FIRST (durable, pre-transform), then
 * reassemble and ingest each order. Returns counts and the newest occurredAt for the watermark.
 */
export async function ingestBulkOrders(
  prisma: PrismaClient,
  args: IngestBulkOrdersArgs,
): Promise<IngestBulkOrdersResult> {
  const records = parseBulkJsonl(args.jsonl);

  const exp = await prisma.shopifyBulkExport.create({
    data: {
      storeId: args.storeId,
      objectType: ObjectType.ORDER,
      bulkOperationId: args.bulkOperationId,
      source: args.source,
      syncRunId: args.syncRunId ?? null,
      recordCount: records.length,
      jsonl: args.jsonl,
    },
    select: { id: true },
  });

  let ingested = 0;
  let maxOccurredAt: Date | null = null;
  for (const node of reassembleOrders(records)) {
    const res = await ingestNode(prisma, {
      storeId: args.storeId,
      objectType: ObjectType.ORDER,
      node,
      source: args.source,
      syncRunId: args.syncRunId,
    });
    ingested++;
    if (res.occurredAt && (!maxOccurredAt || res.occurredAt > maxOccurredAt)) maxOccurredAt = res.occurredAt;
  }

  return { exportId: exp.id, recordCount: records.length, ingested, maxOccurredAt };
}

export interface ReingestBulkExportsArgs {
  storeId: string;
  /** Only reprocess exports captured at/after this. */
  sinceFetchedAt?: Date;
  /** Only reprocess exports from this bulk operation. */
  bulkOperationId?: string;
}

export interface ReingestBulkExportsResult extends Record<string, unknown> {
  exports: number;
  ingested: number;
}

/**
 * Recovery path: re-reassemble and re-project stored bulk exports — no Shopify calls. Use
 * after a reassembly-logic fix to repair backfilled data. Idempotent: re-ingest dedupes the
 * raw log on identical payloads and upserts the live tables by GID. Watermarks are untouched.
 */
export async function reingestBulkExports(
  prisma: PrismaClient,
  args: ReingestBulkExportsArgs,
): Promise<ReingestBulkExportsResult> {
  const where: { storeId: string; objectType: ObjectType; fetchedAt?: { gte: Date }; bulkOperationId?: string } = {
    storeId: args.storeId,
    objectType: ObjectType.ORDER,
  };
  if (args.sinceFetchedAt) where.fetchedAt = { gte: args.sinceFetchedAt };
  if (args.bulkOperationId) where.bulkOperationId = args.bulkOperationId;

  // Oldest-first so a newer export's payloads project last (final state = most recent).
  const ids = await prisma.shopifyBulkExport.findMany({ where, orderBy: { id: "asc" }, select: { id: true } });

  let ingested = 0;
  for (const { id } of ids) {
    const row = await prisma.shopifyBulkExport.findUnique({ where: { id }, select: { storeId: true, jsonl: true } });
    if (!row) continue;
    for (const node of reassembleOrders(parseBulkJsonl(row.jsonl))) {
      await ingestNode(prisma, {
        storeId: row.storeId,
        objectType: ObjectType.ORDER,
        node,
        source: EventSource.BACKFILL,
      });
      ingested++;
    }
  }

  return { exports: ids.length, ingested };
}
