/**
 * Per (store, objectType) high-water mark, persisted in `sync_state`. The floor
 * for an incremental query is the last processed timestamp (or the cutover date
 * on first run). Watermarks only ever move forward.
 */
import type { PrismaClient } from "../db/client.js";
import { ObjectType } from "../generated/prisma/client.js";

/** ISO timestamp to use as the lower bound of the next pull. */
export async function readSinceIso(
  prisma: PrismaClient,
  storeId: string,
  objectType: ObjectType,
  cutoverIso: string,
): Promise<string> {
  const state = await prisma.syncState.findUnique({
    where: { storeId_objectType: { storeId, objectType } },
  });
  const last = state?.lastUpdatedAtProcessed;
  return last ? last.toISOString() : new Date(cutoverIso).toISOString();
}

/** Move the watermark forward to `candidate` if it is newer than the stored value. */
export async function advanceWatermark(
  prisma: PrismaClient,
  storeId: string,
  objectType: ObjectType,
  candidate: Date | null,
): Promise<void> {
  if (!candidate) return;
  const existing = await prisma.syncState.findUnique({
    where: { storeId_objectType: { storeId, objectType } },
  });
  if (existing?.lastUpdatedAtProcessed && existing.lastUpdatedAtProcessed >= candidate) return;
  await prisma.syncState.upsert({
    where: { storeId_objectType: { storeId, objectType } },
    create: { storeId, objectType, lastUpdatedAtProcessed: candidate },
    update: { lastUpdatedAtProcessed: candidate },
  });
}

/**
 * Set the watermark to an explicit value (or null to clear it, so the next sync
 * re-pulls from the cutover date). Unlike advanceWatermark this can move the
 * watermark BACKWARD — used by the replay/reset-watermark admin operation. Safe
 * because all downstream writes are idempotent: a lower watermark just re-pulls.
 */
export async function setWatermark(
  prisma: PrismaClient,
  storeId: string,
  objectType: ObjectType,
  value: Date | null,
): Promise<void> {
  await prisma.syncState.upsert({
    where: { storeId_objectType: { storeId, objectType } },
    create: { storeId, objectType, lastUpdatedAtProcessed: value },
    update: { lastUpdatedAtProcessed: value },
  });
}

export interface BulkState {
  bulkOperationId: string | null;
  bulkStatus: string | null;
}

export async function getBulkState(prisma: PrismaClient, storeId: string, objectType: ObjectType): Promise<BulkState> {
  const state = await prisma.syncState.findUnique({
    where: { storeId_objectType: { storeId, objectType } },
  });
  return { bulkOperationId: state?.bulkOperationId ?? null, bulkStatus: state?.bulkStatus ?? null };
}

export async function setBulkState(
  prisma: PrismaClient,
  storeId: string,
  objectType: ObjectType,
  bulk: BulkState,
): Promise<void> {
  await prisma.syncState.upsert({
    where: { storeId_objectType: { storeId, objectType } },
    create: { storeId, objectType, bulkOperationId: bulk.bulkOperationId, bulkStatus: bulk.bulkStatus },
    update: { bulkOperationId: bulk.bulkOperationId, bulkStatus: bulk.bulkStatus },
  });
}
