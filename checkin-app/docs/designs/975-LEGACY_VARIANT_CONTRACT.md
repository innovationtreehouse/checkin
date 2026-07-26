# Dropping the legacy two-variant product shape

**Status: DESIGN — not built.** Addresses #975 ("Do we need the legacy product
shape with 2 variants in Shopify?"). Answer: **no.** Both legacy two-variant
pairs are dead — nothing writes them, and (confirmed by the board) no live prod
row still depends on them. This doc is the plan to remove them safely.

## What "legacy two-variant shape" means

There are **two** independent two-variant pairs, each already superseded:

| Legacy pair | Model | Superseded by | Superseded in |
|---|---|---|---|
| `shopifyOrgMemberVariantId` + `shopifyNonOrgMemberVariantId` | `Program` | `shopifyVariantId` (single pool + per-enrollee minted discount code) | #930, 2026-07-06 |
| `shopifyNormalVariantId` + `shopifyVolunteerVariantId` | `BoardSettings` | `orgMembershipVariantId` + `volunteerDiscountCode` | membership single-variant switch |

The old model sold each program/membership as one Shopify **product with two
variants** (member vs non-member price) and picked the variant client-side at
checkout. The new model sells **one variant at the base (non-member) price** and
applies member pricing via a server-minted single-use discount code — no
client-side tier pick, so the whole tier-confusion + variant-presence bug class
(#739) goes away by construction.

## Why it's safe to remove — and the one write path that isn't yet closed

- **No live data depends on them** (board-confirmed for #975): every program
  that had the legacy pair has retired; membership moved fully to
  `orgMembershipVariantId`. The columns persist only as read-fallbacks for rows
  that no longer exist.
- **Program *create* writes `shopifyVariantId` only** (`api/programs/route.ts`),
  and nothing writes the membership pair at all.

**But the program pair is NOT write-dead.** `api/programs/[id]/route.ts:197-198`
still accepts `shopifyOrgMemberVariantId` / `shopifyNonOrgMemberVariantId` from
the PATCH body and writes them for any sysadmin/board caller — onto *any*
program, including one that never had them. So a board member could mint a fresh
legacy-dependent row **between the board's "no live rows" confirmation and the
cutover.** If that happens, Release 1 (which removes the checkout ternary and the
webhook matcher) leaves that program charging the wrong tier and its paid
webhook unable to activate.

This does not block removal, but it means the board confirmation is a
point-in-time fact, not a standing guarantee. The plan closes the gap with a
**Release 0** below (strip the PATCH writes first) plus a **re-verify-at-cutover**
gate.

The `isLegacy` branch of `api/programs/[id]/sync-shopify/route.ts` also re-writes
the pair, but only for a program that **already** carries it — it cannot
introduce the pair, so it is not a new-row source.

Net: the columns are dead weight whose only remaining effect is misleading
readers (human and Claude) about how checkout works today — the complaint that
opened #975 — once the lingering PATCH write is closed.

## Blast radius

Dropping the four columns removes real legacy-only code, not just fields.

### Dead code that collapses (deletion)

- **`lib/programs/activateEnrollment.ts`** — the `purchasedOrgMember` param and
  the entire "sibling-inventory mirror" block. With no program carrying legacy
  variants, `purchasedOrgMember` is always `null`, so the block is unreachable.
  Drop the param; drop the block.
- **`lib/shopify.ts` `createShopifyProgramVariants`** — its only non-test caller
  is the `isLegacy` branch below. Once that goes, the function is dead. Delete it.
- **`api/programs/[id]/sync-shopify/route.ts`** — the `isLegacy` fork collapses;
  the repair path is always single-pool.
- **`api/webhooks/shopify/route.ts`** — the variant-matcher `Set`s drop the
  legacy ids (both membership and program); `purchasedOrgMember` computation and
  the arg passed to `activateProgramEnrollment` go away.
- **`lib/finance/reconcile.ts` `membershipVariantIdSet`** — drop the two legacy
  membership ids from the *live reconcile* match set. **NOT from the audit
  universe** — see the audit hazard below.
- **`app/programs/[id]/page.tsx`** — checkout link becomes
  `variantId = program.shopifyVariantId`; the member/non-member ternary and its
  `pricingEligible` plumbing (where used only for the variant pick) go away.

### Mechanical edits (field references)

- `api/programs/route.ts` — GET `select`.
- `api/programs/[id]/route.ts` — PATCH body destructure, conditional writes, and
  the `hasShopifyVariant` presence check. (Removing the two conditional writes is
  also the Release-0 fix above — do it first, on its own.)
- `lib/programCheckout.ts` — `isProgramCheckoutBroken` and the
  `PROGRAM_CHECKOUT_BROKEN_WHERE` Prisma `where`. **Shared predicate** — consumed
  by `api/nav/todo-counts`, both program-ops pages, and `sync-shopify`. Missing
  this means Release 2's DROP breaks nav/todo-counts during the drain window.
- `lib/lifecycleDrift.ts:125-127` — `select` of all three variant columns; feeds
  the lifecycle-reconcile cron / system-status. A stale `select` here aborts the
  cron after DROP.
- `lib/program/capacity.ts:69` — the `program` param type lists the legacy pair.
- `api/dev/shopify/orders-paid/route.ts` — membership + program fallbacks.
- `app/dev/shopify/page.tsx`, `app/program-ops/programs/page.tsx` — selects /
  presence checks.
- `src/security/generated/classifications.ts` — **generated**; regenerate, don't
  hand-edit.
- ~10 test files reference the fields in fixtures/assertions — update alongside.

### The audit hazard — do NOT drop legacy ids from the audit universe

`lib/finance/matchAudit.ts` builds its *entire* order universe from
`mirror.ordersForVariants(allVariants)`, where `allVariants` = the membership
variant set + every program variant. If the legacy ids simply disappear (both
the membership pair and the program columns), historical legacy-era orders fall
out of the audited set completely — they don't stay `MATCHED`, they stop being
looked at. A legacy order whose claim later breaks (e.g. a refund) could then
never surface as `UNCLAIMED_PAID`, reintroducing the #1074 invisible-money class
**by construction.**

The four DB columns are also literally the audit's only record of which variant
ids were legacy, so once they're dropped the audit can't reconstruct the set.
Resolution options (decide before Release 2):

- **(i) Snapshot the legacy ids into a static const** captured at drop time
  (`LEGACY_AUDIT_VARIANT_IDS`) and keep feeding them into the audit universe
  read-only. Preserves audit coverage with no live column.
- **(ii) Accept the coverage loss** with a written rationale — only valid if the
  board confirms every legacy order is fully settled and refund-closed, i.e. no
  legacy claim can ever break. Stronger claim than "no live programs."

Recommend (i): cheap, and it keeps the money-audit invariant intact.

## The deploy hazard (why this is two releases)

A dropped column cannot ship in the same release as the code that stops
selecting it. During a rolling deploy the old pods keep running the old code —
`select: { shopifyOrgMemberVariantId: true }` — against the already-migrated
table, so every such query errors for the whole drain window. Standard
expand/contract, in order:

0. **Release 0 — close the write.** Strip the two `shopifyOrgMemberVariantId` /
   `shopifyNonOrgMemberVariantId` conditional writes from
   `api/programs/[id]/route.ts` (and drop the fields from the program-ops edit
   UI if present). After this deploys, no path can mint a fresh legacy row, so
   the board's "no live rows" fact becomes stable. Tiny, low-risk, ships first.
1. **Release 1 — code only.** Remove every read reference and all the dead code
   above (keeping the audit-universe ids per the hazard section). Schema still
   declares the four columns (now unused). After this deploys, nothing in the
   running fleet selects them.
2. **Release 2 — schema + migration.** Remove the four fields from
   `schema.prisma` and add a `DROP COLUMN` migration. **Re-verify at cutover**
   (query below) that no `Program` row has a legacy variant with a null
   `shopifyVariantId` — the Release-0 → Release-2 window is short, but the check
   is cheap and closes the race for good. Deploys only after Release 1 is fully
   rolled out.

Cutover re-verify query:

```sql
SELECT count(*) FROM "Program"
WHERE "shopifyVariantId" IS NULL
  AND ("shopifyOrgMemberVariantId" IS NOT NULL OR "shopifyNonOrgMemberVariantId" IS NOT NULL);
-- must be 0 before Release 2
SELECT "shopifyNormalVariantId", "shopifyVolunteerVariantId" FROM "BoardSettings" WHERE id = 1;
-- both must be NULL
```

Prod has live data — the migration is `DROP COLUMN` on four nullable columns
(no backfill, no data movement), but it must still be a plain drop, never a
table rebuild / accept-data-loss reset.

**If deploys use a maintenance window / single instance** (no drain overlap),
Releases 1 and 2 collapse into one PR — there is no old pod to break. Release 0
still ships first so the cutover re-verify is meaningful.

## Shopify-side caveat (the plan is DB-only)

Everything above is app + database. Nothing here archives/unpublishes the legacy
two-variant Shopify **products** or voids carts already built against a legacy
variant. After Release 1 removes the webhook matcher, a customer who still has a
stale legacy cart open can complete checkout against a legacy variant and the
paid order will not activate anything — a silent paid-but-stuck order. Low
likelihood once legacy programs are retired, but if any legacy product is still
purchasable, archive/unpublish it in Shopify as part of Release 1. Add to the
cutover checklist.

## Not in scope

This is only the *contract* (removal) of the already-superseded shape. The
end-state segment-gated automatic discounts remain a separate proposal in
`SHOPIFY_MEMBER_SEGMENT_PRICING.md`; nothing here builds toward or blocks it.
