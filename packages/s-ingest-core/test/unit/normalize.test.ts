import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalizeOrder,
  normalizePayout,
  normalizeBalanceTxn,
  orderNodeSchema,
  payoutNodeSchema,
  balanceTxnNodeSchema,
} from "../../src/shopify/schemas.js";

const fixturesDir = new URL("../fixtures/", import.meta.url);
function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, fixturesDir), "utf8"));
}

describe("normalizeOrder", () => {
  const order = loadFixture("order-1001.json") as { node: unknown };
  const n = normalizeOrder(orderNodeSchema.parse(order.node));

  it("maps identifiers and status", () => {
    expect(n.shopifyGid).toBe("gid://shopify/Order/1001");
    expect(n.legacyId).toBe("1001");
    expect(n.name).toBe("#1001");
    expect(n.financialStatus).toBe("PAID");
    expect(n.customerEmail).toBe("buyer@example.com");
  });

  it("converts money sets to cents", () => {
    expect(n.totalCents).toBe(10000);
    expect(n.totalRefundedCents).toBe(2000);
  });

  it("normalizes line items and refunds", () => {
    expect(n.lines).toHaveLength(1);
    expect(n.lines[0]).toMatchObject({ sku: "WIDGET-1", quantity: 2, priceCents: 5000 });
    expect(n.refunds).toHaveLength(1);
    expect(n.refunds[0].totalRefundedCents).toBe(2000);
    expect(n.refunds[0].orderGid).toBe("gid://shopify/Order/1001");
  });

  it("captures a cancellation when present", () => {
    const cancelled = normalizeOrder(
      orderNodeSchema.parse({
        id: "gid://shopify/Order/1001",
        name: "#1001",
        cancelledAt: "2026-03-01T00:00:00Z",
        displayFinancialStatus: "REFUNDED",
      }),
    );
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.financialStatus).toBe("REFUNDED");
  });
});

describe("payout + balance transactions (signed, negatives)", () => {
  const fixtures = loadFixture("payout-with-refund.json") as Array<{ objectType: string; node: unknown }>;
  const payoutNode = fixtures.find((f) => f.objectType === "PAYOUT")!.node;
  const txnNodes = fixtures.filter((f) => f.objectType === "BALANCE_TXN").map((f) => f.node);

  it("normalizes payout summary with a negative refund gross", () => {
    const p = normalizePayout(payoutNodeSchema.parse(payoutNode));
    expect(p.netCents).toBe(7700);
    expect(p.chargesGrossCents).toBe(10000);
    expect(p.refundsGrossCents).toBe(-2000);
  });

  it("keeps a refund balance transaction negative", () => {
    const txns = txnNodes.map((node) => normalizeBalanceTxn(balanceTxnNodeSchema.parse(node)));
    const refund = txns.find((t) => t.type === "REFUND")!;
    expect(refund.netCents).toBe(-2000);
    expect(refund.orderGid).toBe("gid://shopify/Order/1001");
    expect(refund.payoutGid).toBe("gid://shopify/ShopifyPaymentsPayout/5001");
  });

  it("sums balance-transaction nets back to the payout net (negatives included)", () => {
    const p = normalizePayout(payoutNodeSchema.parse(payoutNode));
    const txns = txnNodes.map((node) => normalizeBalanceTxn(balanceTxnNodeSchema.parse(node)));
    const sum = txns.reduce((s, t) => s + t.netCents, 0);
    expect(sum).toBe(p.netCents);
  });
});
