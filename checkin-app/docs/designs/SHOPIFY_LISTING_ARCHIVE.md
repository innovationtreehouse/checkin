# Shopify Listing Archive / Un-archive

**Status:** Shipped on branch `feat/shopify-listing-archive`.
**Product decisions:** interview 2026-07-06 (board/sysadmin retire-a-listing action).

## 1. Problem

A program's Shopify listing (product + variant) is minted at program-create time and
kept in sync afterward (capacity edits, scholarship holds, member discount codes). But
there is no way to *retire* that listing: when a program winds down, is cancelled, or is
mistakenly created, its Shopify product stays `active` and purchasable, and every app-side
checkout surface keeps offering it. The board needs a reversible switch that takes a
program's Shopify listing out of service without destroying sales history or the existing
participant roster.

## 2. Decisions (with rationale)

- **Archiving a program's Shopify info = retire the program↔Shopify linkage in checkin AND
  act on the Shopify side.** On archive we set the Shopify product to `archived` status via
  the Admin API (hidden from the storefront, not purchasable, data preserved); on un-archive
  we restore it to `active`. Doing only one side would drift: an app-only flag would leave
  the product live on the store, and a Shopify-only change would leave every in-app checkout
  surface still building links against a dead listing. We do both, in that order (Shopify
  first, then stamp checkin — see §4 failure handling).

  *Why `archived` and not `draft`:* Shopify's `archived` status is the semantic match for
  "retired" — the product is removed from all sales channels and marked ended, but its order
  history and analytics are preserved, and it round-trips cleanly back to `active`. `draft`
  also hides the product but reads as "not yet published", the wrong signal for a listing
  that *was* live. Un-archive always restores to `active` (the only state programs are sold
  in).

- **Board/sysadmin-only, on the program's Shopify section (program-ops), independent of
  program archiving.** This is an operations action on the Shopify linkage, not a change to
  the program's lifecycle phase. It is deliberately *separate* from archiving the program
  itself (a sibling effort adds program archiving). **Integration point:** a future
  program-archive hook should chain into this — archiving a program should also archive its
  Shopify listing, and un-archiving restore it — by calling the same
  `POST /api/programs/[id]/archive-shopify` semantics (or the `setProgramListingArchived`
  lib fn directly). Until that hook exists the two are operated independently.

- **Sales history and existing participant records are untouched.** Archiving only flips the
  Shopify product status and stamps `Program.shopifyArchivedAt`. `ProgramParticipant` rows,
  `AuditLog`, and any Shopify order history are left exactly as they are. Un-archive restores
  checkout capability (product back to `active`, in-app surfaces re-enabled).

## 3. Data model

`Program.shopifyArchivedAt DateTime?` (`@sensitivity:internal`, nullable, additive).

- **NULL** = the listing is live (the normal state).
- **Set** = the listing is retired; the timestamp records when.

Migration `20260708030000_shopify_listing_archive` adds the one nullable column
(expand-only, no backfill — every existing row defaults to NULL = "live", which is correct).

## 4. Flows

### Archive (`POST /api/programs/[id]/archive-shopify`, body `{ "archived": true }`)

`withAuth({ roles: ['isSysadmin', 'isBoardMember'] })`. Board/sysadmin only.

1. Load the program. 400 if it has no Shopify listing at all (nothing to archive — free
   programs never get a product/variant).
2. Idempotent no-op if it is already in the requested state.
3. `setProgramListingArchived(program, true)` (`lib/shopify.ts`) → PUT the Shopify product
   to `status: archived`. Product id comes from `Program.shopifyProductId`; if only variant
   ids are stored (possible via the manual-repair PATCH path), it is derived by fetching the
   variant (`GET variants/{id}.json → product_id`), mirroring `adjustProgramInventory`.
4. **Stamp checkin regardless of the Shopify result.** `shopifyArchivedAt = now()`, audit-log
   the change.
5. If the Shopify call failed, `setProgramListingArchived` has already logged it
   (`reportShopifyFailure` → IntegrationErrorLog + admin/board email); the route returns a
   `warning` so the operator knows the checkin side is archived but Shopify may still show the
   product live. **Reconcile path:** retry the action, or set the product status by hand in
   the Shopify admin (System Status → Link Status surfaces the failure).

Un-archive is the same route with `{ "archived": false }`: restore the product to `active`
and clear `shopifyArchivedAt`.

### What "archived" gates (treat the program as having NO live Shopify listing)

While `shopifyArchivedAt` is set, every app-side surface that would touch a live listing
treats it as absent — cleanly (no stray 4xx, no warnings, no silent inventory decrements):

| Surface | Behavior when archived |
|---|---|
| **Checkout-link building** (`programs/[id]` enroll page) | Resolves no variant → the existing "no live listing" message; no cart link is built. |
| **Member discount minting** (`POST .../discount-code`) | Returns `{ code: null }` (same as a legacy/free program) → caller falls back to an undiscounted link, never blocks. |
| **Capacity pushes** (`adjustProgramInventory`) | Early-returns success as a no-op. This is the single choke point for *all* relative inventory adjusts — capacity edits (PATCH), scholarship holds (`request-payment-plan` −1), hold releases (+1), and the webhook's sibling mirror — so archiving silences them everywhere at once, with no per-caller guard. |
| **sync-shopify repair** (`POST .../sync-shopify`) | 400 "un-archive first" — never re-mints a live listing for a retired program. |

### What archived does NOT gate: the `orders/paid` webhook

The inbound `orders/paid` webhook still processes orders for an archived program. **Money has
already moved** — a paid order that lands after archive (a late webhook delivery, or a
customer who checked out in the race window before Shopify applied the status change) must
still activate the participant, or we would take someone's money and leave them PENDING
forever. The webhook's DB activation runs unchanged; only its *inventory* side-effects (hold
release, sibling mirror) no-op, because they route through `adjustProgramInventory`, which is
gated. This is correct: an archived product's inventory count is irrelevant.

## 5. Production safety

- **Additive/nullable migration**, expand-only, no backfill — every existing program reads as
  "live". No contract step is needed (the column is never dropped by this work).
- **Never fails a user-facing request on the external call.** `setProgramListingArchived`
  mirrors the rest of `lib/shopify.ts`: mock branch on `config.shopifyMockActive()`, a hard
  fetch timeout via `shopifyFetch`, failures reported via `reportShopifyFailure`, never
  throws — the checkin stamp lands even when Shopify is down, and the operator gets a warning.
- **Drift is visible and reconcilable.** Because archived state can flip while scholarship
  holds are outstanding (holds no-op on Shopify while archived), Shopify's inventory count and
  the app's hold ledger can drift across an archive/un-archive cycle. This is the same class
  of drift the capacity design already documents (crash windows) and is fixed the same way:
  **Sync to Shopify** / manual inventory correction. A periodic reconcile job is deferred
  until the drift is observed in practice.

## 6. Deliberately deferred

- **Program-archive chaining.** The hook that makes archiving a *program* also archive its
  Shopify listing is out of scope here; this PR builds the mechanism and the standalone
  action, and names the integration point (§2) for the sibling program-archive work.
- **Inventory reconcile on un-archive.** Un-archive restores product status but does not
  re-push inventory counts; drift is reconciled manually (§5).
- **Bulk archive.** One program at a time; no batch action.

## 7. Related

- `docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md` — the single-pool capacity model + hold ledger
  whose `adjustProgramInventory` choke point this feature reuses to silence capacity pushes.
- `docs/designs/SHOPIFY_DEV_STORE_WEBHOOK.md` — the webhook whose late-order processing is
  deliberately left ungated.
