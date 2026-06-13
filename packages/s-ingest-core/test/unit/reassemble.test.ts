/**
 * Pure unit tests for the bulk-export reassembly (no DB). `reassembleOrders` is the
 * trickiest pure function in the package — it merges INLINE children with `__parentId`
 * flattened children across `{nodes}` / `{edges}` / bare-array shapes, and must NOT
 * double-count a child returned in both representations (the explicit design goal in
 * bulkOrders.ts). Previously it was exercised only indirectly through one DB test.
 */
import { describe, it, expect } from "vitest";
import { parseBulkJsonl, reassembleOrders } from "../../src/ingest/bulkOrders.js";
import { normalizeOrder } from "../../src/shopify/schemas.js";

const orderId = "gid://shopify/Order/7001";

describe("parseBulkJsonl", () => {
  it("parses one record per non-blank line", () => {
    const text = ['{"id":"a"}', "", "   ", '{"id":"b"}', ""].join("\n");
    expect(parseBulkJsonl(text)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("returns [] for an empty or whitespace-only blob", () => {
    expect(parseBulkJsonl("")).toEqual([]);
    expect(parseBulkJsonl("\n   \n")).toEqual([]);
  });

  it("throws on a malformed JSON line (corrupt export must not pass silently)", () => {
    expect(() => parseBulkJsonl('{"id":"a"}\n{not json}')).toThrow();
  });
});

describe("reassembleOrders", () => {
  it("attaches a __parentId-flattened line item to its order", () => {
    const orders = reassembleOrders([
      { id: orderId, name: "#7001" },
      { id: "gid://shopify/LineItem/9001", __parentId: orderId, sku: "WIDGET-1", quantity: 2 },
    ]);
    expect(orders).toHaveLength(1);
    const n = normalizeOrder(orders[0]);
    expect(n.lines).toHaveLength(1);
    expect(n.lines[0].sku).toBe("WIDGET-1");
  });

  it("seeds children from an INLINE array on the order", () => {
    const orders = reassembleOrders([
      {
        id: orderId,
        lineItems: [{ id: "gid://shopify/LineItem/9001", sku: "INLINE", quantity: 1 }],
        refunds: [{ id: "gid://shopify/Refund/8001", totalRefundedSet: { shopMoney: { amount: "5.00" } } }],
      },
    ]);
    const n = normalizeOrder(orders[0]);
    expect(n.lines[0].sku).toBe("INLINE");
    expect(n.refunds).toHaveLength(1);
  });

  it("reads inline children from a {nodes} connection shape", () => {
    const orders = reassembleOrders([
      { id: orderId, lineItems: { nodes: [{ id: "gid://shopify/LineItem/9001", sku: "NODES", quantity: 1 }] } },
    ]);
    expect(normalizeOrder(orders[0]).lines[0].sku).toBe("NODES");
  });

  it("reads inline children from an {edges:[{node}]} connection shape", () => {
    const orders = reassembleOrders([
      { id: orderId, lineItems: { edges: [{ node: { id: "gid://shopify/LineItem/9001", sku: "EDGES", quantity: 1 } }] } },
    ]);
    expect(normalizeOrder(orders[0]).lines[0].sku).toBe("EDGES");
  });

  it("does NOT double-count a child returned BOTH inline and flattened (same GID)", () => {
    const orders = reassembleOrders([
      { id: orderId, lineItems: { nodes: [{ id: "gid://shopify/LineItem/9001", sku: "WIDGET-1", quantity: 1 }] } },
      // The SAME line also arrives as a flattened __parentId record — must be de-duped by GID.
      { id: "gid://shopify/LineItem/9001", __parentId: orderId, sku: "WIDGET-1", quantity: 1 },
    ]);
    expect(normalizeOrder(orders[0]).lines).toHaveLength(1);
  });

  it("attaches a flattened refund and ignores unrelated child types", () => {
    const orders = reassembleOrders([
      { id: orderId },
      { id: "gid://shopify/Refund/8001", __parentId: orderId, totalRefundedSet: { shopMoney: { amount: "9.00" } } },
      { id: "gid://shopify/Fulfillment/3001", __parentId: orderId }, // not part of the projection
    ]);
    const n = normalizeOrder(orders[0]);
    expect(n.refunds).toHaveLength(1);
    expect(n.lines).toHaveLength(0);
  });

  it("drops an orphan __parentId line whose parent order is absent", () => {
    const orders = reassembleOrders([
      { id: "gid://shopify/LineItem/9001", __parentId: "gid://shopify/Order/DOES-NOT-EXIST", sku: "X", quantity: 1 },
    ]);
    expect(orders).toHaveLength(0);
  });

  it("derives legacyResourceId from the GID when absent in bulk output", () => {
    const [order] = reassembleOrders([{ id: orderId, name: "#7001" }]);
    expect(normalizeOrder(order).legacyId).toBe("7001");
  });

  it("keeps an explicit legacyResourceId when present", () => {
    const [order] = reassembleOrders([{ id: orderId, legacyResourceId: "EXPLICIT" }]);
    expect(normalizeOrder(order).legacyId).toBe("EXPLICIT");
  });
});
