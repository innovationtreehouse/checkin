# Dropping the legacy two-variant product shape

**Status: DONE — code removal shipped (PR #1464), `DROP COLUMN` migration
shipped (PR #1508).** Addresses #975 ("Do we need the legacy product shape with 2
variants in Shopify?"). Answer: **no.** Both legacy two-variant pairs are dead —
nothing writes them, and (confirmed by the board) no live prod row still depends
on them.

Releases 0 and 1 below shipped together in PR #1464: the write path is closed and
no code reads the columns any more. The four columns are still declared in
`schema.prisma`, so **Release 2 is what actually closes #975** — see
[the deploy hazard](#the-deploy-hazard-why-the-drop-is-its-own-release) for what's
left and the two gotchas it must not miss.

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

## Why it's safe to remove — and the write path that is now closed

> **Closed by #1464.** The write described here is gone. Retained because it is
> what justifies still running the cutover re-verify query before Release 2.

- **No live data depends on them** (board-confirmed for #975): every program
  that had the legacy pair has retired; membership moved fully to
  `orgMembershipVariantId`. The columns persisted only as read-fallbacks for rows
  that no longer exist.
- **Program *create* wrote `shopifyVariantId` only** (`api/programs/route.ts`),
  and nothing ever wrote the membership pair.

**The program pair was not write-dead, though.** `PATCH /api/programs/[id]`
accepted `shopifyOrgMemberVariantId` / `shopifyNonOrgMemberVariantId` from the
body and wrote them for any sysadmin/board caller — onto *any* program, including
one that never had them. A board member could therefore have minted a fresh
legacy-dependent row **after the board's "no live rows" confirmation**, and the
Release 1 removals (checkout ternary, webhook matcher) would leave that program
charging the wrong tier with its paid webhook unable to activate.

That made the board confirmation a point-in-time fact rather than a standing
guarantee — which is why Release 0 closed the write, and why the cutover re-verify
gate below still earns its keep even now that it has.

The `isLegacy` branch of `api/programs/[id]/sync-shopify/route.ts` also re-wrote
the pair, but only for a program that **already** carried it — it could not
introduce the pair, so it was never a new-row source.

Net: the columns are dead weight whose only remaining effect is misleading readers
(human and Claude) about how checkout works today — the complaint that opened
#975.

## Blast radius

Dropping the four columns removes real legacy-only code, not just fields.

### Dead code that collapses (deletion)

- **`lib/programs/activateEnrollment.ts`** — the `purchasedOrgMember` param and
  the entire "sibling-inventory mirror" block. (This doc originally justified it
  as "`purchasedOrgMember` is always `null`" — that is wrong: on the webhook path
  it is `false`, only the reconciler passes `null`. The block is dead anyway, for
  a different reason: with no legacy program, either `shopifyVariantId` is set —
  so the `!program?.shopifyVariantId` guard is false — or the program is free, in
  which case `hasProgramItem` never matches and nothing activates in the first
  place.) Drop the param; drop the block.
- **`lib/shopify.ts` `createShopifyProgramVariants`** — its only non-test caller
  is the `isLegacy` branch below. Once that goes, the function is dead. Delete it.
- **`api/programs/[id]/sync-shopify/route.ts`** — the `isLegacy` fork collapses;
  the repair path is always single-pool.
- **`api/webhooks/shopify/route.ts`** — the variant-matcher `Set`s drop the
  legacy ids (both membership and program); `purchasedOrgMember` computation and
  the arg passed to `activateProgramEnrollment` go away.
- **`lib/finance/reconcile.ts` `membershipVariantIdSet`** — drop the two legacy
  membership ids. This is the one shared set the live reconciler and `matchAudit`
  both consume; see the audit hazard below for why dropping them from it turned
  out to be a no-op rather than a narrowing.
- **`lib/shopify.ts` `adjustProgramInventory`** — takes `{ shopifyVariantId }`
  only, and adjusts that one pool instead of looping a variant array. (Missed by
  this doc's original blast radius; it is the function `lib/program/capacity.ts`
  and `lib/lifecycleDrift.ts` both feed.)
- **`app/programs/[id]/page.tsx`** — checkout link becomes
  `variantId = program.shopifyVariantId`; the member/non-member ternary and its
  `pricingEligible` plumbing (where used only for the variant pick) go away.

### Mechanical edits (field references)

- `api/programs/route.ts` — GET `select`.
- `api/programs/[id]/route.ts` — PATCH body destructure, conditional writes, and
  the `hasShopifyVariant` presence check. (The two conditional writes are the
  Release-0 fix above.)
- `lib/programCheckout.ts` — `isProgramCheckoutBroken` and the
  `PROGRAM_CHECKOUT_BROKEN_WHERE` Prisma `where`. **Shared predicate** — consumed
  by `api/nav/todo-counts`, both program-ops pages, and `sync-shopify`. Missing
  this means Release 2's DROP breaks nav/todo-counts during the drain window.
- `lib/lifecycleDrift.ts` — `healEnrollmentI1`'s `program` `select` of all three
  variant columns; feeds the lifecycle-reconcile cron / system-status. A stale
  `select` here aborts the cron after DROP.
- `lib/program/capacity.ts` — `withdrawAndReleaseHold`'s `program` param type
  lists the legacy pair.
- `api/dev/shopify/orders-paid/route.ts` — membership + program fallbacks.
- `app/dev/shopify/page.tsx`, `app/program-ops/programs/page.tsx` — selects /
  presence checks.
- `src/security/generated/classifications.ts` — **generated**; regenerate, don't
  hand-edit. Because the fields are *removed* rather than re-tiered, the
  `security-boundary-isolation` workflow's re-tier detection does not fire, so
  this may ride along with the schema change (`generated/` is not a boundary file).
- `shopify-live/product-inventory.shopify-live.ts` — builds a program literal for
  `adjustProgramInventory`. No local or CI run executes it (`*.shopify-live.ts` is
  excluded everywhere), but `tsconfig.json` includes `**/*.ts`, so **`tsc` type-checks
  it** and a stale literal fails the build on excess-property. Also missed by the
  original blast radius.
- `docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md` §2 asserted the two-pool shape as
  current — per the deploy doc's rule 2, docs asserting a shape are part of the
  cutover.
- 14 test files reference the fields in fixtures/assertions — update alongside.
  Two of them (`activateEnrollmentRedelivery`, `enrollmentStateOracle`) name only
  `purchasedOrgMember`, so a grep for the column names misses them; `tsc` catches
  both.

### The audit hazard — RESOLVED: no snapshot needed

This section originally framed the removal as *causing* a loss of audit coverage,
and left a choice open ("decide before Release 2") between snapshotting the legacy
ids into a `LEGACY_AUDIT_VARIANT_IDS` const or accepting the loss. **Neither is
needed. The premise was wrong.**

`lib/finance/matchAudit.ts` builds its order universe from
`mirror.ordersForVariants(allVariants)`, where `allVariants` = the membership
variant set + every program variant. But it assembles `programByVariant` by
iterating **live row values** and skipping nulls (`if (v)`). With no prod row
carrying a legacy id, those ids contribute nothing to `allVariants` **today** —
so removing the `select` entries is behaviour-identical, not a narrowing.

Two consequences worth stating plainly, because the original framing obscured
both:

- **There is nothing to snapshot.** A snapshot const would faithfully reproduce
  the columns' contents, which is the empty set. Options (i) and (ii) collapse
  into the same no-op.
- **Any legacy-era-order coverage gap already exists** and was created when those
  programs were retired, not by this work. If that gap matters, it is a separate
  question about historical orders in the mirror — do not conflate it with this
  removal, which cannot make it worse.

Note the decision *does* depend on the no-legacy-rows fact, so the cutover
re-verify query below is what keeps this reasoning honest. Had a legacy row
survived, option (i) as written would also have been insufficient: the audit maps
variant → program to test a claim (`claimedSet.has(program.id)`), so a bare id
list would leave every legacy order permanently `UNCLAIMED_PAID`. A real snapshot
would have needed `{ variantId, programId, programName }`.

## The deploy hazard (why the DROP is its own release)

A dropped column cannot ship in the same release as the code that stops selecting
it. The reason is **step ordering, not task concurrency**: `deploy-prod.yml` runs
"Run database migrations" (`prisma migrate deploy`, to completion) as a separate,
*earlier* step than "Deploy to ECS" (`update-service`). So the schema is fully
migrated while the old task is still serving live traffic, and every query still
selecting a dropped column errors until the new task takes over.

Standard expand/contract, in order:

0. **Release 0 — close the write.** ✅ *Shipped in #1464.* Strip the two
   `shopifyOrgMemberVariantId` / `shopifyNonOrgMemberVariantId` conditional writes
   from `api/programs/[id]/route.ts`, and the fields from the program-ops edit UI.
   After this deploys, no path can mint a fresh legacy row, so the board's "no live
   rows" fact becomes stable.
   - The program-ops "Shopify Checkout Identifiers" card turned out to expose *only*
     the two legacy inputs, with no `shopifyVariantId` field at all — so deleting
     them outright would have removed the manual-repair path the card exists for.
     Replaced with a single Variant ID input (the PATCH already accepted it).
1. **Release 1 — code only.** ✅ *Shipped in #1464, folded in with Release 0.*
   Remove every read reference and all the dead code above. Schema still declares
   the four columns (now unused). After this deploys, nothing in the running fleet
   selects them.
   - Folding 0 into 1 is safe *because* Release 0 also replaces the only UI that
     could mint a legacy row; the window it guarded is closed by the same deploy.
2. **Release 2 — schema + migration.** ⬜ *Outstanding.* Remove the four fields
   from `schema.prisma`, add a `DROP COLUMN` migration, regenerate
   `classifications.ts`. **Re-verify at cutover** (query below) that no `Program`
   row has a legacy variant with a null `shopifyVariantId`. Deploys only after
   Release 1 is fully rolled out in **prod** — note that merging to `main` only
   deploys *dev*; prod cuts from a published release, so two PRs merged before one
   release still land in prod together and re-open this hazard.
   - **Must also delete the `DROPPED_SOON` array** in
     `src/app/__tests__/programsAPI.integration.test.ts`. That test derives its
     expected public-column set from the generated classifications, which still
     tier the two dead `Program` fields `public` while the schema declares them;
     Release 1 excluded them by name to keep the oracle honest. Leaving the array
     in place after the regeneration makes the oracle silently under-check.

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

> **Correction — an earlier version of this doc said Releases 1 and 2 could
> collapse into one PR "if deploys use a maintenance window / single instance (no
> drain overlap), because there is no old pod to break." That escape clause does
> not apply to this pipeline and must not be used.** The prod service does run at
> `desiredCount 1`, but the hazard is not overlap: migrations complete in their own
> earlier workflow step, before `update-service` is issued at all, so the old task
> serves traffic against the migrated schema regardless of how many tasks there
> are or what `minimumHealthyPercent` is set to. Only scaling the service to 0
> *before* migrating would earn the collapse, and neither deploy workflow does
> that. Concretely, collapsing them would 500 the **public** program catalog
> (`GET /api/programs` via `PUBLIC_PROGRAM_SELECT`), `GET /api/programs/[id]`,
> `nav/todo-counts`, and the lifecycle-reconcile cron for the length of that window.

## Shopify-side: nothing to clean up (confirmed 2026-08-02)

This plan is app + database only — it never archived/unpublished the legacy
two-variant Shopify **products**, and it can't void carts already built against a
legacy variant.

That was worth checking, because Release 1 removed the webhook matcher: a customer
still holding a stale legacy cart could complete checkout against a legacy variant
and have the paid order activate nothing — a silent paid-but-stuck order.

**Confirmed there are no stale legacy items in the store**, so there is no
purchasable legacy product and no cart that can reach that state. No store-side
action is required, and this is not a Release 2 prerequisite.

## Not in scope

This is only the *contract* (removal) of the already-superseded shape. The
end-state segment-gated automatic discounts remain a separate proposal in
`SHOPIFY_MEMBER_SEGMENT_PRICING.md`; nothing here builds toward or blocks it.
