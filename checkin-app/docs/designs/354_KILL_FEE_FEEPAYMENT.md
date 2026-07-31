# Kill `Fee`/`FeePayment` — dead, redundant schema

Status: PLAN · Issue: [#354](https://github.com/innovationtreehouse/checkin/issues/354) · Backlog: **FR7** (DECISION), consumer **P13**

---

## 1. The logic (basis for removal)

`Fee`/`FeePayment` are removed because they are **dead and redundant**, full stop — not because of
any specific feature. Nothing ever writes them, and the payment truth they would hold already lives,
authoritatively, in the Shopify pipeline.

Two facts establish this:

### 1a. Nothing writes `Fee`/`FeePayment` — no production path, ever

Grep across `src`, `prisma`, `packages`: the only writers are `seed-helpers.ts` (dev fixture) and one
integration test. `FeePayment.create` has **zero** non-test hits. `programs/[id]/route.ts` reads
`fees: true`, but no frontend renders it. The merge route reconciles `feePayments` that can never
exist. Write-dead schema — carries migration, security-classification, and coverage weight for tables
that can never hold a row.

### 1b. Program payment is already stored — in the Shopify pipeline, not in `Fee`/`FeePayment`

| Payment fact | Where it authoritatively lives |
|---|---|
| Did they pay? | `ProgramParticipant.status = ACTIVE` + `ProgramParticipant.shopifyOrderId` |
| The order / link | `ProgramParticipant.shopifyOrderId` → `shopify_read` mirror |
| Amount / financial status / refunds | **Shopify** (source of truth), mirrored to `shopify_read`, re-read live by `shopifyOrderId` |
| Price owed | `Program.orgMemberPriceCents` / `nonOrgMemberPriceCents` |
| Problem payments (refund / chargeback / mismatch / active-without-payment) | `PaymentException`, keyed on `shopifyOrderId` |

Flow: pay in Shopify → `orders/paid` webhook → `activateEnrollment` stamps `status=ACTIVE` +
`shopifyOrderId`, clears the scholarship hold → daily `reconcile.ts` diffs `shopify_read` vs
enrollment truth → anything needing a human becomes a `PaymentException`. This pipeline is **live and
reconciled daily**.

Every `FeePayment` field is already covered: `paidAt`/`shopifyLink` duplicate
`status`+`shopifyOrderId`+`shopify_read`; amount duplicates `Program.*PriceCents`+Shopify;
`quickBooksInvoice` belongs to the unbuilt QB epic (backlog **FE**), not here. `FeePayment` is a
parallel, hand-maintained copy of what a live daily-reconciled pipeline already stores.

**Verdict:** FR7 → **kill** `Fee`/`FeePayment`. No new tables. Removal needs no replacement feature.

### 1c. Was there any consumer that needed it? (checked — no)

The maintainer built the schema for eventual "PL/board tracks who paid" ([#354 comment](https://github.com/innovationtreehouse/checkin/issues/354)).
We stress-tested the strongest version of that — *let a PL see whether a participant has paid, without
revealing full-pay vs scholarship vs plan* — and it still does **not** want `FeePayment`:

- `FeePayment` would show scholarship families (no payment row) as **unpaid** → inverts the privacy
  requirement.
- The wanted signal already derives from `ProgramParticipant.status`: `ACTIVE` is reached by all three
  settled paths (paid webhook `activateEnrollment.ts`, scholarship comp, plan approval), collapsing the
  cases into one bit by construction; the sensitive *how* (`isPaymentPlanRequested`, `inventoryHeldAt`,
  `paymentPlanDeniedAt`) sits at tiers PL never receives.

So even the schema's intended consumer is served without it. (If that PL "who paid" view is ever
built, it derives from `ProgramParticipant.status` — a separate feature, not a reason to keep this
schema.)

---

## 2. Delete `Fee` / `FeePayment` (FR7 kill)

Empty in prod (no write path ever ran), so data-safe. Two constraints shape the sequencing:

- **Rolling-deploy drain:** old pods keep running `include: { fees: true }`
  ([programs/[id]/route.ts:77](../../src/app/api/programs/[id]/route.ts)) until Release 1 fully rolls
  out, so the **models must stay in `schema.prisma` and the tables must exist** through Release 1.
  Removing the models from the schema early creates schema-vs-DB drift, and the next unrelated
  `prisma migrate dev` would auto-fold a `DROP TABLE` into a Release-1 migration → old pods 500. So
  schema-model removal + drop migration land **together in Release 2**.
- **Boundary isolation** ([AGENTS.md:114](../../AGENTS.md), CI `security-boundary-isolation.yml`):
  changes to `src/security/registry.ts` / `scopeBindings.ts` must ship in **their own PR** with no
  app/feature code. So Release 1 is **two PRs**.

> Fire the `migration-safety` and `safe-refactor-sweep` skills. `tsc` green is necessary-not-sufficient
> here — mocks, security oracles, and generated classifications are tsc-blind.
>
> Same code-only-then-schema+drop sequencing as the sibling plan in
> [#1327](https://github.com/innovationtreehouse/checkin/pull/1327) (`975-LEGACY_VARIANT_CONTRACT.md`).
> That plan also needs a "Release 0 — close the write" step; this one doesn't (no writer exists).

### Release 1 — remove code references (schema + tables untouched)

**PR 1a — app/test code:**

| File | Change |
|---|---|
| `src/app/api/programs/[id]/route.ts:77` | remove `fees: true` include |
| `src/app/api/membership-ops/participants/merge/route.ts` | remove `feePayments: true` include (×2, lines 85/99), the `feePayments` counter (190), and the reconcile loop (248-258) |
| `src/app/api/membership-ops/participants/merge/__tests__/route.integration.test.ts` | remove fee/feePayment fixtures + assertions (~99, 109, 213-234, 281-303) — leave non-fee merge cases |
| `src/lib/dev/seed-helpers.ts:321` | remove the `prisma.fee.create` block |
| `src/lib/dev/__tests__/seed-helpers.integration.test.ts:71` | remove `fees: true` from the include |
| `src/app/api/programs/price-cents.test.ts` | (optional) stale "Fee" mentions in comments only |

After 1a, `'Fee'` still sits in `registry.returns` — that's an **inert over-declaration** (`returns`
is a grant list; nothing asserts it equals the actual include, and `Fee` is not an EDGE_MODEL, so
`routeAuthDrift` is unaffected). It's cleaned up in 1b.

**PR 1b — security boundary (own PR, per AGENTS.md:114):**

| File | Change |
|---|---|
| `src/security/registry.ts:43` | drop `'Fee'` from `returns`; fix the `fees (Fee)` comment (line 41) |

A now-unused grant → inert removal. No app code in this PR.

The `FeePayment` binding (`src/security/scopeBindings.ts:92-95`) **cannot** move here: while
`FeePayment` is still in `schema.prisma`, its `personal` fields make it sensitive-and-scopable, so
`validateBindings` coverage rule (b) (`scopes.ts`) errors "silent over-restriction" the moment the
binding disappears. `OPT_OUT_PENDING_ROUTE` is a work queue for routes not built yet, not a
graveyard for dying models. The binding goes in Release 2, where the model leaves `classifications`
in the same PR (keeping it past that point flips the failure to rule (a), "binding for unknown
model").

Gate each PR: full `jest` (per `jest-run` skill), not just `tsc`. Watch the merge integration test (1a)
and `routeAuthDrift` (1b).

### Release 2 — schema removal + drop migration (own PR, after Release 1 fully deployed)

| File | Change |
|---|---|
| `prisma/schema.prisma:893` | remove `fees Fee[]` on `Program` |
| `prisma/schema.prisma:167` | remove `feePayments FeePayment[]` on `Person` |
| `prisma/schema.prisma:956-992` | remove `model Fee` + `model FeePayment` |
| `src/security/scopeBindings.ts:92-95` | remove the `FeePayment` binding (must land with the schema removal — see Release 1b); update the `Fee`/`RSVP` explainer comments (18-23, 74-77) |
| `tests/security/scopeBindingsEquivalence.test.ts` | drop the `FeePayment` case + the unbound-model `'Fee'` entry; binding count 18 → 17 |
| `tests/security/ctxNeeds.test.ts:194` | drop `'Fee'` from `MODELS` |
| `src/__tests__/livePersonDriftGuard.test.ts:38,211` | drop `feePayment` from the person-scoped model regex |
| `prisma/migrations/<new>/migration.sql` | the DROP below |
| `src/security/generated/classifications.ts` | **regenerated** by `prisma generate` (schema-driven, not hand-edited); `check-route-coverage.ts` guards freshness. If `security-boundary-isolation.yml` flags `src/security/generated/`, split this regen into its own boundary PR |

```sql
ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_feeId_fkey";
ALTER TABLE "FeePayment" DROP CONSTRAINT IF EXISTS "FeePayment_personId_fkey";
ALTER TABLE "Fee" DROP CONSTRAINT IF EXISTS "Fee_programId_fkey";
DROP TABLE "FeePayment";
DROP TABLE "Fee";
```

Only safe once no running code issues `include: { fees: true }` / `feePayments`. Confirm prod row
counts are 0 first (they must be — no writer exists).

---

## 3. Backlog wiring

- **FR7** → resolve as **kill**, rationale = §1 (dead + redundant with the Shopify pipeline).
  Cross-link the two "consciously NOT building" lines (fees live in Shopify; payment-plan in QB).
- **P13** (manual-only programs) — the only consumer that ever wanted a write path — is satisfied by
  `status`+`shopifyOrderId` too; does not resurrect `FeePayment`.
