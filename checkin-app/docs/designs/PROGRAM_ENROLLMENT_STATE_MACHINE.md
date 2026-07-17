# ProgramParticipant enrollment lifecycle — one declarative definition

Status: **DRAFT — review before code.**
Scope: `ProgramParticipant` — the enrollment trunk (`status` PENDING → ACTIVE) plus the
scholarship hold-ledger as a **parallel region** on the PENDING leg.

The pattern, the ratified decisions (definition-not-executor,
derived-not-a-column), the seeing/assessing surfaces, and the outbox / reconciler / CHECK
strategy all live in the umbrella — **`LIFECYCLE_ARCHITECTURE.md`**. This doc is *only* what's
specific to this machine.
Shopify / capacity mechanics context: `../PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md` §1–4.
Out of scope: `OrgMembershipProcess` (separate machine — `ORG_MEMBERSHIP_STATE_MACHINE.md`);
`TODO(#278)` cart-attribute trust at `webhooks/shopify/route.ts:103`.

---

## 1. Trunk: enrollment (base machine)

The trunk is the `status` column plus row existence. A row *is* an enrollment; no row = not
enrolled.

```
            enroll (free / external-admin comp)
   ∅ ─────────────────────────────────────────────►  ACTIVE
   │                                                    ▲
   │ enroll (paid)                                      │ activate
   ▼                                                    │ (payment / plan-approved)
 PENDING ───────────────────────────────────────────────┘
   │
   │ withdraw  (self / admin / non-payment kick / grace expiry)
   ▼
   ∅  (row deleted)
```

- **Trunk states:** `UNENROLLED` (∅, no row) · `PENDING` · `ACTIVE`.
- `ACTIVE` leaves only by withdrawal (→∅); there is no ACTIVE→PENDING edge.

## 2. Parallel region: scholarship hold-ledger (only meaningful while PENDING)

Overlaid on the PENDING leg, derived from three ledger columns — `inventoryHeldAt` (the
ledger bit: non-null = one Shopify seat outstanding), `isPaymentPlanRequested`,
`paymentPlanDeniedAt`:

```
 PENDING · NO_HOLD ──apply(−1 ok)──►  PENDING · HELD ──deny(no op)──►  PENDING · HELD_DENIED
 (inventoryHeldAt     held set,        (awaiting board)   held stays       held stays,
  null)               req=true                            ◄──re-apply──    deniedAt set
   │                                                        (clears denial, no 2nd −1)
   │ apply(−1 FAILS: hold stamp rolled back, req stays true)
   ▼
 PENDING · HOLD_FAILED ──board manual-hold (human removed the seat)──►  PENDING · HELD
 (held null, req=true — the −1 never landed; the board's problem, never auto-swept)
```

On reaching ACTIVE the region collapses: the seat is `CONSUMED` (held → null, never a +1) via
approval, or `RELEASED` (+1) by any withdrawal / the pay-anyway webhook. Trunk and region are
coupled: **ACTIVE forces the region to no-hold** — invariant I1 below.

## 3. Legal states (this is what the validator encodes)

Six named legal states. `held` = `inventoryHeldAt`, `req` = `isPaymentPlanRequested`, `den` =
`paymentPlanDeniedAt`. `·` = don't-care (a vestigial flag — see note).

| State                 | status  | held | req | den | Meaning |
|-----------------------|---------|------|-----|-----|---------|
| `UNENROLLED`          | (no row)| —    | —   | —   | not enrolled / withdrawn |
| `PENDING_UNPAID`      | PENDING | null | false| null| plain checkout, 7-day non-payment clock; no seat held |
| `PENDING_HOLD_FAILED` | PENDING | null | true| null| applied but the apply-time −1 failed — no seat held; the board finishes it (Shopify reconciliation queue), never swept |
| `PENDING_HELD`        | PENDING | set  | true| null| applied, seat held, awaiting board decision |
| `PENDING_HELD_DENIED` | PENDING | set  | false| set| denied, seat still held, grace-expiry clock |
| `ACTIVE`              | ACTIVE  | null | ·   | ·   | paid / comped / plan-approved — seat settled |

**`req` is the discriminator among the two held=null PENDING states** (no longer a vestigial
don't-care there): `req=false` = `PENDING_UNPAID` (7-day non-payment sweep eligible); `req=true` =
`PENDING_HOLD_FAILED` (the apply-time `−1` failed, so the request stands but no seat is held — it
is the board's job to finish, via the Shopify reconciliation queue, and it must NEVER be
auto-swept). The two finance-ops queues split on `held`, so these never mix.

**Vestigial-flag note (the remaining `·` cells — deliberate, not laxness):**
- `ACTIVE` with `req=true` or `den≠null`: the webhook's activation flips `status` and releases
  the hold but does not scrub `req`/`den` (a HELD/HELD_DENIED applicant who paid Shopify
  directly before the board acted). Inert once ACTIVE — the finance-ops queue filters
  `status:'PENDING'`. Legal.

So the validator asserts at ACTIVE only what matters: **`held` must be null.**

## 4. Invariants — the validator (`validate` in the definition module)

Any row failing one is off-diagram (crash-window corruption or a future bug):

- **I1 — ACTIVE ⟹ held = null.** An active enrollment holding a seat = a `−1` that never comes
  back → permanent over-decrement. *(Crash: webhook committed `status=ACTIVE`, died before the
  release `+1`.)* The money invariant, and the single detectable signature of the §3-capacity
  crash window that has no reconcile job today.
- **I2 — held ≠ null ⟹ status = PENDING.** Corollary of I1.
- **I3 — PENDING ∧ held ≠ null ⟹ exactly one of {req ∧ ¬den} (awaiting) or {¬req ∧ den}
  (denied).** Never both, never neither.
- **I4 — PENDING ∧ held = null ⟹ den = null.** A denial is always stamped on a held seat. The
  two held=null states (`PENDING_UNPAID`, `PENDING_HOLD_FAILED`) both satisfy this; they differ
  only by `req`, which is a discriminator, not an invariant — so `PENDING_HOLD_FAILED` is
  on-diagram, not an I4 violation.

## 5. Transitions → enforcement sites (guards stay byte-for-byte)

The definition documents and supplies the `where`/predicate these already hand-write; it never
replaces the transition guard. CAS = compare-and-set `updateMany` with expected prior state in
`where`; `delete()` = atomicity boundary; `FOR UPDATE` = capacity lock.

| # | Transition | From → To | Actor | Shopify | Guard (unchanged) | Site |
|---|-----------|-----------|-------|---------|-------------------|------|
| T1 | enroll (paid) | ∅ → PENDING_UNPAID | user/admin | — | `FOR UPDATE` capacity lock in tx | `participants/route.ts` POST :118-133 |
| T2 | enroll (free / ext-admin comp) | ∅ → ACTIVE | user/admin | — | same tx; `initialStatus` at :118 | `participants/route.ts` POST :118-133 |
| T3 | apply / re-apply (−1 ok) | PENDING_UNPAID → PENDING_HELD (or HELD_DENIED → HELD) | user | **−1** | CAS `status:PENDING, held:null` (branch 1) / `held:{not:null}` (branch 2) | `request-payment-plan/route.ts` :86-100 |
| T3f | apply (−1 **FAILS**) | PENDING_UNPAID → PENDING_HOLD_FAILED | user | −1 attempted, rolled back | on failed −1, roll `held` back to null; `req` stays true (the request stands, applicant told nothing more is needed) | `request-payment-plan/route.ts` :101-117 |
| T3m | board manual-hold | PENDING_HOLD_FAILED → PENDING_HELD | admin | none (human removed the seat in Shopify) | CAS `status:PENDING, inventoryHeldAt:null, isPaymentPlanRequested:true` → stamp `held`; confers no benefit, so no COI guard | `finance-ops/payment-plans/manual-hold/route.ts` |
| T4 | activate via payment | PENDING(any) → ACTIVE | Shopify webhook (+ reconciler) | **+1 iff held** | CAS `status:PENDING`; release CAS `held:{not:null}→null` | `activateEnrollment.ts` :61-90 ← `webhooks/shopify/route.ts` :193 |
| T5 | approve | PENDING_HELD → ACTIVE | admin | none (consume) | CAS `isPaymentPlanRequested:true, status:PENDING`; sets `held:null` **without +1**; COI guard | `finance-ops/payment-plans/route.ts` :83-86 |
| T6 | deny | PENDING_HELD → PENDING_HELD_DENIED | admin | none | CAS `isPaymentPlanRequested:true, status:PENDING`; stamps `den`, leaves `held`; COI guard | `finance-ops/payment-plans/refuse/route.ts` :45-48 |
| T7 | non-payment kick | PENDING_UNPAID → ∅ | cron | +1 iff held | `delete()`; query filters `req:false, den:null` — excludes PENDING_HELD **and** PENDING_HOLD_FAILED (both `req=true`), so a hold-failed request is never swept | `cron/pending-participants/route.ts` :68-78 (:17 filter) |
| T8 | grace expiry | PENDING_HELD_DENIED → ∅ | cron | **+1** | `delete()`; NULL graceDays = off | `cron/scholarship-grace-expiry/route.ts` :33-46 |
| T9 | withdraw | PENDING/ACTIVE → ∅ | user/admin | +1 iff held | `delete()` = atomicity boundary | `participants/route.ts` DELETE :172-232 → `capacity.ts` withdrawAndReleaseHold :65-80 |

T4/T7/T8/T9 release through the one `withdrawAndReleaseHold` (or the webhook's inline
equivalent): **+1 iff the removed row still had `held` set**. Approval (T5) is the only path
that clears `held` *without* a +1 — it *consumes* the seat. That single rule is now declared
once (I1 + this column) instead of inferred across five files.

Approve (T5) / deny (T6) also fire on a `PENDING_HOLD_FAILED` row (`held=null`) via the same
`isPaymentPlanRequested:true, status:PENDING` CAS — a **gated override**: approving there comps a
seat that was never removed (phantom), so the UI puts it behind a red confirm that steers the
board to T3m (manual-hold) first. The guards don't hard-block it; the deliberate path is the UI's.

## 6. Module + refactor targets

`src/lib/programs/enrollmentState.ts` — instances the `lib/lifecycle` primitives (umbrella §3):

- `STATES` — the six states, each a `StateSet` (`statuses` + `has(row)` predicate +
  `where` Prisma fragment).
- `classify(row)` / `validate(row)` — the named state, or which of I1–I4 broke.
- `TRANSITIONS` — the §5 table as data (drives the generated diagram / coverage matrix /
  reachability report / BFS check — umbrella §6.1).

Refactor sites (consume the definition, keep every guard byte-for-byte):
- finance-ops scholarship queue GET filter → `STATES.PENDING_HELD.where`; the Shopify
  reconciliation queue (same route, `?queue=holds`) → `STATES.PENDING_HOLD_FAILED.where`. The
  new manual-hold CAS `where` stays literal (a transition guard, like the others below).
- grace-expiry cron `findMany` → `STATES.PENDING_HELD_DENIED.where` (+ `lte: cutoff`).
- pending-participants cron → `STATES.PENDING_UNPAID.where` (+ `pendingSince`).
- request-payment-plan / activate: the CAS `where` clauses stay literal — they encode
  *transitions* ("from-state ∧ nothing-changed-under-me"), deliberately narrower than a state
  predicate; assert against `matches` in tests, do not widen.

## 7. This machine's residue of the shared decisions

General decisions (derived-not-column, definition-not-engine) → umbrella §2–3. Entity-specific:

**CHECK-constraint caveat.** I1 as a Postgres row `CHECK` would reject the webhook's current
**two-step** write (it commits `status=ACTIVE` in T4's updateMany #1, then clears `held` in #2 —
the intermediate committed row violates I1). Adopting the CHECK (umbrella §4.3) requires first
collapsing T4's two writes into one `updateMany` (`status:ACTIVE, held:null` together; the `+1`
stays a separate best-effort call). Natural to do alongside the outbox work; out of scope for
the first cut.

## 8. Test plan (per AGENTS.md test classes)

- **unit** (`enrollmentState.test.ts`): `classify`/`validate` over the six legal tuples + the
  remaining ACTIVE vestigial-flag cases (legal) + the four I1–I4 violations (off-diagram).
  `STATES[x].where` agrees with `STATES[x].has` on a generated row matrix; the two held=null
  states (`PENDING_UNPAID` vs `PENDING_HOLD_FAILED`) must classify apart on `req`.
- **integration**: after each of T3–T9 (incl. the T3f fail edge and T3m manual-hold) against a
  real DB, the row `classify`es to the expected
  state and `validate`s clean. A simulated crash window (apply T4's first `updateMany`, skip the
  release) produces an I1 violation `validate` flags — the reconcile oracle.
- **flow**: existing apply→deny→grace-expiry and apply→approve end-to-end paths still pass
  (definition is non-behavioral); assert no row leaves a step off-diagram.

## 9. Reconcile (entity note)

Invariant-driven reconcile strategy → umbrella §4.2. Entity-specific heal: for an **I1** row
(ACTIVE + held) the safe auto-fix is clear `held` → null and fire the compensating `+1` the
webhook missed. Generalizes `lib/finance/reconcile.ts` from order-driven to invariant-driven.

Related history: `4cb5d1d2` (#930 single-pool supersedes two-pool mirror), `a86f3727` (#926
request guarded to PENDING), `34a92fb7` (#931 org-member snapshot at approval).
