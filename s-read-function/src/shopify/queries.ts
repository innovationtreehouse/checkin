/**
 * GraphQL query/mutation strings. Field selections target the pinned 2025-07 Admin schema.
 *
 * VERIFIED against 2025-07: the balance-transaction fields (`transactionDate`,
 * `associatedOrder`, `sourceOrderTransactionId`, `associatedPayout`) and the `processed_at`
 * search filter all exist.
 *
 * ⚠️ ONE FIELD STILL TO CONFIRM — `PAYOUT_FIELDS.summary` selects `refundsGross`, but the
 * documented sibling on ShopifyPaymentsPayoutSummary is `refundsFeeGross`. GraphQL rejects
 * the ENTIRE request on an unknown field, so confirm the exact spelling before the first live
 * payouts run:
 *   https://shopify.dev/docs/api/admin-graphql/2025-07/objects/ShopifyPaymentsPayoutSummary
 * The Zod schemas are lenient (a missing value degrades to 0/undefined), but the query itself
 * must validate.
 */

const MONEY_BAG = `{ shopMoney { amount currencyCode } }`;
const MONEY_V2 = `{ amount currencyCode }`;

/** Trivial connectivity/auth check: confirms the token + API version reach the store. */
export const SHOP_PING_QUERY = `
  query Ping {
    shop {
      name
      myshopifyDomain
      currencyCode
      ianaTimezone
    }
  }
`;

/** Authoritative store identity, resolved at sync start to derive store_id.
 * NOTE: unlike Order/Payout, the Shop type does NOT expose legacyResourceId —
 * requesting it fails the whole query. The numeric id is derived from the gid. */
export const SHOP_IDENTITY_QUERY = `
  query ShopIdentity {
    shop {
      id
      myshopifyDomain
      name
    }
  }
`;

const ORDER_FIELDS = `
  id
  legacyResourceId
  name
  email
  customer { email displayName }
  createdAt
  processedAt
  updatedAt
  cancelledAt
  test
  displayFinancialStatus
  displayFulfillmentStatus
  currentSubtotalPriceSet ${MONEY_BAG}
  totalShippingPriceSet ${MONEY_BAG}
  currentTotalTaxSet ${MONEY_BAG}
  totalDiscountsSet ${MONEY_BAG}
  currentTotalPriceSet ${MONEY_BAG}
  totalRefundedSet ${MONEY_BAG}
  lineItems(first: 100) {
    nodes {
      id
      sku
      title
      quantity
      originalUnitPriceSet ${MONEY_BAG}
      totalDiscountSet ${MONEY_BAG}
    }
  }
  refunds {
    id
    createdAt
    totalRefundedSet ${MONEY_BAG}
    note
  }
`;

/**
 * Orders probe used by the `read-orders` CLI command. Includes customer fields,
 * which require the read_customers scope (and protected-customer-data approval).
 */
export const ORDERS_PROBE_QUERY = `
  query OrdersProbe($first: Int!, $query: String) {
    orders(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
      edges {
        node {
          id
          legacyResourceId
          name
          email
          customer { email displayName }
          createdAt
          updatedAt
          cancelledAt
          displayFinancialStatus
          displayFulfillmentStatus
          currentTotalPriceSet ${MONEY_BAG}
          lineItems(first: 5) { nodes { id title quantity } }
        }
      }
    }
  }
`;

/** Paginated orders query. Pass query: "updated_at:>=<iso> status:any". */
export const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      edges { node { ${ORDER_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

/**
 * Minimal payouts probe — safe, well-established fields only (no summary sub-fields),
 * so a clean result confirms the read_shopify_payments_* scopes without risking an
 * unknown-field error. Used by the `read-payouts` CLI command.
 */
export const PAYOUTS_PROBE_QUERY = `
  query PayoutsProbe($first: Int!) {
    shopifyPaymentsAccount {
      payouts(first: $first) {
        edges {
          node {
            id
            legacyResourceId
            issuedAt
            status
            net ${MONEY_V2}
          }
        }
      }
    }
  }
`;

/**
 * Balance-transactions probe — selects the exact fields the real sync depends on,
 * including the previously-unverified payout↔order bridge fields (associatedPayout,
 * associatedOrder, sourceOrderTransactionId). A clean result validates the full
 * BALANCE_TRANSACTIONS_QUERY against the live schema.
 */
export const BALANCE_TXNS_PROBE_QUERY = `
  query BalanceTxnsProbe($first: Int!) {
    shopifyPaymentsAccount {
      balanceTransactions(first: $first) {
        edges {
          node {
            id
            type
            amount ${MONEY_V2}
            fee ${MONEY_V2}
            net ${MONEY_V2}
            transactionDate
            sourceOrderTransactionId
            associatedPayout { id }
            associatedOrder { id name }
          }
        }
      }
    }
  }
`;

const PAYOUT_FIELDS = `
  id
  legacyResourceId
  issuedAt
  status
  net ${MONEY_V2}
  summary {
    chargesGross ${MONEY_V2}
    chargesFee ${MONEY_V2}
    refundsGross ${MONEY_V2}
    refundsFee ${MONEY_V2}
    adjustmentsGross ${MONEY_V2}
    adjustmentsFee ${MONEY_V2}
    reservedFundsGross ${MONEY_V2}
    retriedPayoutsGross ${MONEY_V2}
  }
`;

/** Paginated payouts query. Pass query: "issued_at:>=<iso>". */
export const PAYOUTS_QUERY = `
  query Payouts($first: Int!, $after: String, $query: String) {
    shopifyPaymentsAccount {
      payouts(first: $first, after: $after, query: $query) {
        edges { node { ${PAYOUT_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const BALANCE_TXN_FIELDS = `
  id
  type
  amount ${MONEY_V2}
  fee ${MONEY_V2}
  net ${MONEY_V2}
  transactionDate
  sourceOrderTransactionId
  associatedPayout { id }
  associatedOrder { id name }
`;

/**
 * Paginated balance transactions. The incremental `query` filter uses `processed_at` — a
 * documented search field on the 2025-07 balanceTransactions connection — which is the SAME
 * instant the node exposes as `transactionDate`, the field the watermark advances on. So the
 * filter axis equals the watermark axis: no skipped rows, no silent full re-pull. `sortKey` is
 * deliberately omitted so the connection uses its default (PROCESSED_AT, ascending), which the
 * watermark walk relies on — do not add a sortKey here. Other valid scopes: `payout_id:<legacyId>`.
 */
export const BALANCE_TRANSACTIONS_QUERY = `
  query BalanceTransactions($first: Int!, $after: String, $query: String) {
    shopifyPaymentsAccount {
      balanceTransactions(first: $first, after: $after, query: $query) {
        edges { node { ${BALANCE_TXN_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

/** Kick off a bulk export. The inner query string is a full operation document. */
export const BULK_OPERATION_RUN_MUTATION = `
  mutation BulkRun($query: String!) {
    bulkOperationRunQuery(query: $query) {
      bulkOperation { id status }
      userErrors { field message }
    }
  }
`;

export const CURRENT_BULK_OPERATION_QUERY = `
  query CurrentBulkOperation {
    currentBulkOperation {
      id
      status
      errorCode
      objectCount
      url
      partialDataUrl
    }
  }
`;

/** Bulk export of orders updated since the cutover. Children arrive as separate
 * JSONL lines carrying `__parentId`, reassembled by bulk.ts before normalization. */
export function buildOrdersBulkQuery(updatedAtFloorIso: string): string {
  return `
    {
      orders(query: "updated_at:>=${updatedAtFloorIso} status:any", sortKey: UPDATED_AT) {
        edges {
          node {
            id
            legacyResourceId
            name
            email
            createdAt
            processedAt
            updatedAt
            cancelledAt
            test
            displayFinancialStatus
            displayFulfillmentStatus
            currentSubtotalPriceSet ${MONEY_BAG}
            totalShippingPriceSet ${MONEY_BAG}
            currentTotalTaxSet ${MONEY_BAG}
            totalDiscountsSet ${MONEY_BAG}
            currentTotalPriceSet ${MONEY_BAG}
            totalRefundedSet ${MONEY_BAG}
            lineItems {
              edges {
                node {
                  id
                  sku
                  title
                  quantity
                  originalUnitPriceSet ${MONEY_BAG}
                  totalDiscountSet ${MONEY_BAG}
                }
              }
            }
            refunds {
              id
              createdAt
              totalRefundedSet ${MONEY_BAG}
              note
            }
          }
        }
      }
    }
  `;
}
