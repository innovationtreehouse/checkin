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

## Why it's safe to remove

- **No write path creates new legacy rows.** Program create writes
  `shopifyVariantId` only (`api/programs/route.ts`). Nothing writes the
  membership pair at all. The *only* surviving legacy writer is the `isLegacy`
  branch of `api/programs/[id]/sync-shopify/route.ts`, which re-writes a program
  that **already** carries the pair — it cannot introduce the pair onto a
  program that lacks it.
- **No live data depends on them** (board-confirmed for #975): every program
  that had the legacy pair has retired; membership moved fully to
  `orgMembershipVariantId`. The columns persist only as read-fallbacks for rows
  that no longer exist.

So the columns are pure dead weight whose only remaining effect is misleading
readers (human and Claude) about how checkout works today — which is the
complaint that opened #975.

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
- **`lib/finance/reconcile.ts` `membershipVariantIdSet`** and
  **`lib/finance/matchAudit.ts`** — drop the two legacy membership ids from the
  match set.
- **`app/programs/[id]/page.tsx`** — checkout link becomes
  `variantId = program.shopifyVariantId`; the member/non-member ternary and its
  `pricingEligible` plumbing (where used only for the variant pick) go away.

### Mechanical edits (field references)

- `api/programs/route.ts` — GET `select`.
- `api/programs/[id]/route.ts` — PATCH body destructure, conditional writes, and
  the `hasShopifyVariant` presence check.
- `api/dev/shopify/orders-paid/route.ts` — membership + program fallbacks.
- `app/dev/shopify/page.tsx`, `app/program-ops/programs/page.tsx` — selects /
  presence checks.
- `src/security/generated/classifications.ts` — **generated**; regenerate, don't
  hand-edit.
- ~10 test files reference the fields in fixtures/assertions — update alongside.

## The deploy hazard (why this is two releases)

A dropped column cannot ship in the same release as the code that stops
selecting it. During a rolling deploy the old pods keep running the old code —
`select: { shopifyOrgMemberVariantId: true }` — against the already-migrated
table, so every such query errors for the whole drain window. Standard
expand/contract, in order:

1. **Release 1 — code only.** Remove every reference and all the dead code
   above. Schema still declares the four columns (now unused). After this
   deploys, nothing in the running fleet selects them.
2. **Release 2 — schema + migration.** Remove the four fields from
   `schema.prisma` and add a `DROP COLUMN` migration. Deploys only after
   Release 1 is fully rolled out.

Prod has live data — the migration is `DROP COLUMN` on four nullable columns
(no backfill, no data movement), but it must still be a plain drop, never a
table rebuild / accept-data-loss reset.

**If deploys use a maintenance window / single instance** (no drain overlap),
collapse both releases into one PR — there is no old pod to break.

## Not in scope

This is only the *contract* (removal) of the already-superseded shape. The
end-state segment-gated automatic discounts remain a separate proposal in
`SHOPIFY_MEMBER_SEGMENT_PRICING.md`; nothing here builds toward or blocks it.
