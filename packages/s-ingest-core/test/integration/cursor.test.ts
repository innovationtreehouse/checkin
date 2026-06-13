/**
 * Integration tests for the watermark / cursor logic (real Postgres). These invariants
 * are correctness-critical: an `advanceWatermark` that moved backward, or a `setWatermark`
 * that refused to, would silently drop or re-pull data. Skipped unless SHOPIFY_READ_DATABASE_URL is set.
 */
import { it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../src/db/client.js";
import { readSinceIso, advanceWatermark, setWatermark, getBulkState, setBulkState } from "../../src/sync/cursor.js";
import { ObjectType } from "../../src/generated/prisma/client.js";
import { describeDb } from "../helpers/db.js";

const STORE = "cursor-test.myshopify.com";
const OT = ObjectType.ORDER;
const CUTOVER = "2026-01-01T00:00:00.000Z";

describeDb("watermark / cursor", () => {
  beforeEach(async () => {
    await prisma.syncState.deleteMany({ where: { storeId: STORE } });
  });
  afterAll(async () => {
    await prisma.syncState.deleteMany({ where: { storeId: STORE } });
    await prisma.$disconnect();
  });

  it("readSinceIso returns the cutover on first run (no state yet)", async () => {
    expect(await readSinceIso(prisma, STORE, OT, CUTOVER)).toBe(CUTOVER);
  });

  it("readSinceIso returns the stored watermark once set", async () => {
    const ts = new Date("2026-03-15T12:00:00.000Z");
    await advanceWatermark(prisma, STORE, OT, ts);
    expect(await readSinceIso(prisma, STORE, OT, CUTOVER)).toBe(ts.toISOString());
  });

  it("advanceWatermark only ever moves forward", async () => {
    const mid = new Date("2026-03-15T12:00:00.000Z");
    await advanceWatermark(prisma, STORE, OT, mid);

    // Older candidate is ignored…
    await advanceWatermark(prisma, STORE, OT, new Date("2026-02-01T00:00:00.000Z"));
    expect(await readSinceIso(prisma, STORE, OT, CUTOVER)).toBe(mid.toISOString());

    // …equal candidate is ignored…
    await advanceWatermark(prisma, STORE, OT, new Date(mid));
    expect(await readSinceIso(prisma, STORE, OT, CUTOVER)).toBe(mid.toISOString());

    // …newer candidate advances.
    const later = new Date("2026-04-01T00:00:00.000Z");
    await advanceWatermark(prisma, STORE, OT, later);
    expect(await readSinceIso(prisma, STORE, OT, CUTOVER)).toBe(later.toISOString());
  });

  it("advanceWatermark is a no-op for a null candidate", async () => {
    await advanceWatermark(prisma, STORE, OT, null);
    const state = await prisma.syncState.findUnique({ where: { storeId_objectType: { storeId: STORE, objectType: OT } } });
    expect(state).toBeNull();
  });

  it("setWatermark can move the watermark BACKWARD (replay / reset path)", async () => {
    await advanceWatermark(prisma, STORE, OT, new Date("2026-04-01T00:00:00.000Z"));
    const back = new Date("2026-02-01T00:00:00.000Z");
    await setWatermark(prisma, STORE, OT, back);
    expect(await readSinceIso(prisma, STORE, OT, CUTOVER)).toBe(back.toISOString());
  });

  it("setWatermark(null) clears the watermark so the next sync re-pulls from cutover", async () => {
    await advanceWatermark(prisma, STORE, OT, new Date("2026-04-01T00:00:00.000Z"));
    await setWatermark(prisma, STORE, OT, null);
    expect(await readSinceIso(prisma, STORE, OT, CUTOVER)).toBe(CUTOVER);
  });

  it("getBulkState / setBulkState round-trip and default to nulls", async () => {
    expect(await getBulkState(prisma, STORE, OT)).toEqual({ bulkOperationId: null, bulkStatus: null });
    await setBulkState(prisma, STORE, OT, { bulkOperationId: "gid://shopify/BulkOperation/1", bulkStatus: "RUNNING" });
    expect(await getBulkState(prisma, STORE, OT)).toEqual({
      bulkOperationId: "gid://shopify/BulkOperation/1",
      bulkStatus: "RUNNING",
    });
  });
});
