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

Empty in prod (no write path ever ran), so data-safe. But old code reads `fees: true` during the
rolling-deploy drain window, so the table drop must be a **separate later release**.

> Fire the `migration-safety` and `safe-refactor-sweep` skills. `tsc` green is necessary-not-sufficient
> here — mocks, security oracles, and generated classifications are tsc-blind.

### Release 1 — remove all code references (table still exists)

| # | File | Change |
|---|---|---|
| 1 | `prisma/schema.prisma:893` | remove `fees Fee[]` on `Program` |
| 2 | `prisma/schema.prisma:167` | remove `feePayments FeePayment[]` on `Person` |
| 3 | `prisma/schema.prisma:956-992` | remove `model Fee` + `model FeePayment` |
| 4 | `src/app/api/programs/[id]/route.ts:77` | remove `fees: true` include |
| 5 | `src/security/registry.ts:43` | drop `'Fee'` from `returns`; fix the `fees (Fee)` comment (line 41) |
| 6 | `src/app/api/membership-ops/participants/merge/route.ts` | remove `feePayments: true` include (×2, lines 85/99), the `feePayments` counter (190), and the reconcile loop (248-258) |
| 7 | `src/app/api/membership-ops/participants/merge/__tests__/route.integration.test.ts` | remove fee/feePayment fixtures + assertions (lines ~99, 109, 213-234, 281-303) — leave the non-fee merge cases |
| 8 | `src/security/scopeBindings.ts:92-95` | remove the `FeePayment` binding; update the `Fee`/`RSVP` explainer comments (18-23, 74-77) |
| 9 | `src/lib/dev/seed-helpers.ts:321` | remove the `prisma.fee.create` block |
| 10 | `src/lib/dev/__tests__/seed-helpers.integration.test.ts:71` | remove `fees: true` from the include |
| 11 | `prisma generate` | **regenerate** `src/security/generated/classifications.ts` — do NOT hand-edit; `check-route-coverage.ts` guards freshness |
| 12 | `src/app/api/programs/price-cents.test.ts` | (optional) stale "Fee" mentions in comments only — no logic touches this model |

Gate: full `jest` (per `jest-run` skill), not just `tsc`. Watch `routeAuthDrift` (registry↔include
must match after #5) and the merge integration test.

### Release 2 — drop the tables (after Release 1 fully deployed)

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
