# Lifecycle machines — ProgramParticipant & OrgMembershipProcess

Each stateful entity has **one declarative lifecycle definition**. It names the legal states,
emits a Prisma `where` per state-set (so server queries and client gating derive from one
source), and a `validate()` that flags off-diagram rows. **Postgres stays the runtime
authority** — transitions are enforced by compare-and-set `updateMany`, `FOR UPDATE` locks,
`delete()`, and partial unique indexes, unchanged. The definition is a source of truth +
validator, **not** a runtime engine that executes transitions.

## Where it lives
- `src/lib/lifecycle/` — shared, client-safe primitives (no runtime Prisma import):
  `defineStateSet` (emits `has()` + `where` from one spec — `flags` for nullable timestamps,
  `equals` for boolean columns), the `classify`/`validate` harness (`assertNever`,
  `defineValidator`), `TRANSITIONS` + `isLegalTransition`/`reachability`/`bfsStates`,
  `fromWhere` (a transition's from-state `where`), enum parity (`Expect`/`Equal`/`assertEnumParity`).
- `src/lib/programs/enrollmentState.ts` — the **enrollment** machine.
- `src/lib/membership/lifecycle.ts` — the **membership** machine.
- `docs/generated/lifecycle/{enrollment,membership}.md` — **auto-generated** diagram +
  coverage matrix + reachability. Do not hand-edit; regenerate. The artifacts-drift test fails
  if `TRANSITIONS` changed without regenerating.
- `app/api/cron/lifecycle-reconcile` — invariant-driven reconciler; violations also surface in
  System Status.
- Tests: status-literal allowlist drift, BFS state-space safety, artifacts drift, guard↔`TRANSITIONS`
  `fromWhere` parity.

## Enrollment (ProgramParticipant) — 6 states
Trunk `status` PENDING→ACTIVE plus a scholarship hold-ledger (`inventoryHeldAt`,
`isPaymentPlanRequested`, `paymentPlanDeniedAt`). States: `UNENROLLED` (no row),
`PENDING_UNPAID`, `PENDING_HOLD_FAILED` (apply-time Shopify `−1` failed — the board finishes it
via the Shopify-holds queue; **never auto-swept**), `PENDING_HELD`, `PENDING_HELD_DENIED`,
`ACTIVE`. Invariants (`validate`):
- **I1** `ACTIVE ⟹ inventoryHeldAt = null` — a stranded hold is a permanent Shopify
  over-decrement (the money invariant).
- **I2** `held ≠ null ⟹ PENDING`. **I3** `PENDING ∧ held ≠ null ⟹` exactly one of `{req ∧ ¬den}`
  / `{¬req ∧ den}`. **I4** `PENDING ∧ held = null ⟹ den = null`.

Full table + diagram: `../generated/lifecycle/enrollment.md`. Shopify/capacity mechanics:
`../PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md`.

## Membership (OrgMembershipProcess) — 10 states
Dues + background-check + renewal. BG and payment are **parallel tracks** that converge at
`activate()` / `clearBackgroundCheck()` under a `FOR UPDATE` lock. `kind ∈ INITIAL | RENEWAL |
PERSON_BG`. `RENEWAL_PENDING_BG` is dead-but-guarded legacy (the reachability test asserts it's
unreachable). Full diagram/table: `../generated/lifecycle/membership.md`.

**Who fires the payment edge (`PENDING_PAYMENT → ACTIVE`).** The generated matrix records that
the edge is *legal*, not who drives it. The recovery choke point is `activate()` (renewals route
through it too — `grantRenewalPayment` is the board-only renewal path, actor `board/sysadmin`).
Three actors reach `activate()`:
1. **Shopify `orders/paid` webhook** (`app/api/webhooks/shopify/route.ts`) — the low-latency path,
   activates in real time when the family pays.
2. **Backup s-read reconciler** (`app/api/cron/reconcile-shopify` → `lib/finance/reconcile.ts`,
   `runReconcile`) — the **guaranteed backstop for a missed webhook**. Forward pass recovers a paid
   order still stuck at `PENDING_PAYMENT` via `activate()` (idempotent — stores `shopifyOrderId`,
   short-circuits on `paidAt`); reversal pass raises a refund/chargeback on an already-activated
   order to the board (never auto-reversed). The route comment owns the exact cadence; the *decision*
   is daily-not-hourly, a scale-to-zero Aurora constraint (infra#129), trading ~1h recovery for ~24h.
   No-op when the mirror isn't wired.
3. **Manual board action** (membership-ops) — the human override.

This is distinct from `app/api/cron/lifecycle-reconcile` (see *Detection & healing*), which heals
*off-diagram* rows; the s-read reconciler recovers *on-diagram* rows stuck at a checkpoint because
an event never fired.

## Changing a machine — the rules
1. **Add / rename a status** → update the definition module. `classify` is a total `switch`
   (`assertNever` default), so it won't compile until every status is handled; the enum-parity
   test guards the local union against the Prisma enum.
2. **New query filter on these models** → consume a `StateSet.where`; do not hand-code a status
   *set*. The allowlist test fails otherwise (single bare-status reads are exempt; genuine sets
   and CAS guards must use the definition or be allowlisted with a justification).
3. **CAS transition guard** → its from-state clause comes from `fromWhere(edge)`; the
   guard↔`TRANSITIONS` parity test catches a guard that drifts from the table.
4. **Every transition is ONE atomic write** (or one `FOR UPDATE` tx) — never commit an illegal
   intermediate tuple. *(Enrollment activate once flipped status then cleared the hold in two
   separate commits, leaving a crash-persistent `ACTIVE + held` row (an I1 violation); collapsed
   to a single write. Membership already does this everywhere.)*
5. **Regenerate the artifacts** after editing `TRANSITIONS` (the drift test enforces it).

## Detection & healing
`validate(row)` is the oracle: `classify(row) == null ⟺ validate flags` (proven exhaustively by
the state-space safety test — the whole bounded space is enumerated). The reconciler cron detects
off-diagram rows, auto-heals the one safe case (enrollment **I1** → clear held + fire the missed
Shopify `+1`), and reports the rest to the sysadmin/board channel; System Status shows the current
violation set.

## Decided & deferred — do not rebuild
- **Transactional outbox — deferred.** Shopify's inventory API is a *relative* adjust
  (non-idempotent), so an outbox worker's redelivery re-introduces the same dual-write it was
  meant to fix. Guards + `validate()` + the reconciler already close the crash window reactively
  at this scale. Revisit only if observed drift frequency justifies it.
- **DB `CHECK` constraints — deferred.** Would require every multi-step write collapsed to one
  statement first (CHECK is per-statement, non-deferrable) and would double-encode the invariants
  (SQL + TS) — the very drift this layer fights. The atomic-write discipline (rule 4) is the
  cheaper root-cause fix.
- **`classify` badge in row views + SQL `lifecycle_state` view — not built.** The reconciler +
  System Status cover the need for now.
