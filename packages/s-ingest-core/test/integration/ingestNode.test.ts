/**
 * Integration test for ingestNode's durability guarantee (real Postgres): the raw event is
 * appended in its OWN commit FIRST, so a later projection failure leaves the event on the
 * append-only log for replay and rethrows — it never silently swallows the node. Skipped
 * unless SHOPIFY_READ_DATABASE_URL is set.
 */
import { it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../src/db/client.js";
import { ingestNode } from "../../src/ingest/ingestNode.js";
import { EventSource, ObjectType } from "../../src/generated/prisma/client.js";
import { describeDb } from "../helpers/db.js";

const STORE = "ingestnode-test.myshopify.com";

const orderNode = (overrides: Record<string, unknown> = {}) => ({
  id: "gid://shopify/Order/8001",
  legacyResourceId: "8001",
  name: "#8001",
  updatedAt: "2026-02-01T10:00:00Z",
  displayFinancialStatus: "PAID",
  currentTotalPriceSet: { shopMoney: { amount: "100.00", currencyCode: "USD" } },
  ...overrides,
});

describeDb("ingestNode durability", () => {
  beforeEach(async () => {
    await prisma.shopifyRawEvent.deleteMany({ where: { storeId: STORE } });
    await prisma.shopOrderLine.deleteMany({ where: { storeId: STORE } });
    await prisma.shopOrder.deleteMany({ where: { storeId: STORE } });
  });
  afterAll(async () => {
    await prisma.shopifyRawEvent.deleteMany({ where: { storeId: STORE } });
    await prisma.shopOrderLine.deleteMany({ where: { storeId: STORE } });
    await prisma.shopOrder.deleteMany({ where: { storeId: STORE } });
    await prisma.$disconnect();
  });

  it("returns the raw event id and inserted=true on a successful ingest", async () => {
    const res = await ingestNode(prisma, {
      storeId: STORE,
      objectType: ObjectType.ORDER,
      node: orderNode(),
      source: EventSource.HAND_LOADED,
    });
    expect(res.inserted).toBe(true);
    expect(res.shopifyGid).toBe("gid://shopify/Order/8001");
    expect(await prisma.shopOrder.count({ where: { storeId: STORE } })).toBe(1);
  });

  it("retains the raw event and rethrows when projection fails", async () => {
    // total_cents is an int4 column; a value past 2^31 overflows at projection-insert time —
    // AFTER the raw event has already been committed in its own transaction.
    const overflowing = orderNode({ currentTotalPriceSet: { shopMoney: { amount: "99999999999.99", currencyCode: "USD" } } });

    await expect(
      ingestNode(prisma, { storeId: STORE, objectType: ObjectType.ORDER, node: overflowing, source: EventSource.HAND_LOADED }),
    ).rejects.toThrow();

    // The append-only log kept the event (replayable) …
    expect(
      await prisma.shopifyRawEvent.count({ where: { storeId: STORE, shopifyGid: "gid://shopify/Order/8001" } }),
    ).toBe(1);
    // … but the live table was NOT written (the projection transaction rolled back).
    expect(await prisma.shopOrder.count({ where: { storeId: STORE } })).toBe(0);
  });
});
