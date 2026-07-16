/**
 * Cursor pagination in fetchers.ts (the shared `paginate` generator + the three
 * connection pickers). Drives each fetcher with a scripted fake client and asserts:
 * cursor threading across pages, termination on hasNextPage=false and on a null
 * endCursor, an absent/null connection yielding nothing, the per-stream page sizes,
 * and that the payouts/balance-txn pickers reach through the singleton
 * `shopifyPaymentsAccount`.
 */
import { describe, it, expect } from "vitest";
import { fetchOrders, fetchPayouts, fetchBalanceTransactions } from "../../src/shopify/fetchers.js";
import { BALANCE_TRANSACTIONS_QUERY } from "../../src/shopify/queries.js";
import { fakeClient, queue } from "../helpers/fakeClient.js";

async function drain<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const n of gen) out.push(n);
  return out;
}

const ordersPage = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null) => ({
  orders: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage, endCursor } },
});
const payoutsPage = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null) => ({
  shopifyPaymentsAccount: { payouts: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage, endCursor } } },
});
const balanceTxnPage = (nodes: unknown[], hasNextPage: boolean, endCursor: string | null) => ({
  shopifyPaymentsAccount: { balanceTransactions: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage, endCursor } } },
});

describe("fetchOrders pagination", () => {
  it("yields a single page and stops when hasNextPage is false", async () => {
    const client = fakeClient(ordersPage([{ id: "o1" }, { id: "o2" }], false, "c1"));
    const nodes = await drain(fetchOrders(client, "updated_at:>='X' status:any"));

    expect(nodes).toEqual([{ id: "o1" }, { id: "o2" }]);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].variables).toMatchObject({ first: 50, after: null, query: "updated_at:>='X' status:any" });
  });

  it("threads endCursor into the next page's `after` and concatenates pages", async () => {
    const client = fakeClient(queue(ordersPage([{ id: "o1" }], true, "cursor-1"), ordersPage([{ id: "o2" }], false, null)));
    const nodes = await drain(fetchOrders(client, "f"));

    expect(nodes).toEqual([{ id: "o1" }, { id: "o2" }]);
    expect(client.calls).toHaveLength(2);
    expect(client.calls[0].variables.after).toBeNull();
    expect(client.calls[1].variables.after).toBe("cursor-1");
  });

  it("stops when hasNextPage is true but endCursor is null (defensive)", async () => {
    const client = fakeClient(ordersPage([{ id: "o1" }], true, null));
    const nodes = await drain(fetchOrders(client, "f"));

    expect(nodes).toEqual([{ id: "o1" }]);
    expect(client.calls).toHaveLength(1); // did not loop forever
  });

  it("yields nothing when the orders connection is absent", async () => {
    const client = fakeClient({ somethingElse: true });
    expect(await drain(fetchOrders(client, "f"))).toEqual([]);
    expect(client.calls).toHaveLength(1);
  });

  it("yields nothing for an empty edge set", async () => {
    const client = fakeClient(ordersPage([], false, null));
    expect(await drain(fetchOrders(client, "f"))).toEqual([]);
  });
});

describe("fetchPayouts pagination (singleton account)", () => {
  it("reaches through shopifyPaymentsAccount.payouts and uses the 100-item page size", async () => {
    const client = fakeClient(payoutsPage([{ id: "p1" }], false, null));
    const nodes = await drain(fetchPayouts(client, "issued_at:>='X'"));

    expect(nodes).toEqual([{ id: "p1" }]);
    expect(client.calls[0].variables).toMatchObject({ first: 100, after: null, query: "issued_at:>='X'" });
  });

  it("yields nothing when shopifyPaymentsAccount is null (Payments not enabled)", async () => {
    const client = fakeClient({ shopifyPaymentsAccount: null });
    expect(await drain(fetchPayouts(client, "f"))).toEqual([]);
  });

  it("paginates across pages", async () => {
    const client = fakeClient(queue(payoutsPage([{ id: "p1" }], true, "pc1"), payoutsPage([{ id: "p2" }], false, null)));
    expect(await drain(fetchPayouts(client, "f"))).toEqual([{ id: "p1" }, { id: "p2" }]);
    expect(client.calls[1].variables.after).toBe("pc1");
  });
});

describe("fetchBalanceTransactions pagination (singleton account)", () => {
  it("reaches through shopifyPaymentsAccount.balanceTransactions", async () => {
    const client = fakeClient(balanceTxnPage([{ id: "b1" }, { id: "b2" }], false, null));
    const nodes = await drain(fetchBalanceTransactions(client, "processed_at:>='X'"));

    expect(nodes).toEqual([{ id: "b1" }, { id: "b2" }]);
    expect(client.calls[0].variables).toMatchObject({ first: 100, query: "processed_at:>='X'" });
  });

  it("yields nothing when the balanceTransactions connection is absent", async () => {
    const client = fakeClient({ shopifyPaymentsAccount: {} });
    expect(await drain(fetchBalanceTransactions(client, "f"))).toEqual([]);
  });

  // Watermark correctness depends on the connection's DEFAULT sort (PROCESSED_AT ascending,
  // the same axis the `processed_at` filter and the watermark use). A stray sortKey override
  // would break the monotonic walk, so guard against it.
  it("does not override sortKey (relies on the default PROCESSED_AT ascending)", () => {
    expect(BALANCE_TRANSACTIONS_QUERY).not.toMatch(/sortKey/);
  });
});
