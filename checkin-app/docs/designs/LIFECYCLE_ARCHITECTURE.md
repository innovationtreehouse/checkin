# Lifecycle definitions — the house pattern for stateful entities

Status: **PROPOSAL — for review.** Umbrella over two in-flight entity designs.
Author's note: this supersedes the "which state-machine library" framing. The question
was never *which library*. It is *where authority lives and who is allowed to move it* —
and, once that's answered, *how we stop re-deriving the answer by hand in five places.*

Covers, and is the parent of (both live in `docs/designs/`):
- `PROGRAM_ENROLLMENT_STATE_MACHINE.md` — the **enrollment** machine (`ProgramParticipant`:
  enrollment trunk + scholarship hold parallel region). Shopify/capacity context it builds on:
  `../PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md` §1–4.
- `ORG_MEMBERSHIP_STATE_MACHINE.md` — the **membership** machine (`OrgMembershipProcess`:
  dues / BG / renewal).

These two were designed independently and reached the *same* structure. That is the
evidence this should be a standard, not two one-offs.

---

## 1. The diagnosis: "ad-hoc flows" is two distinct diseases

Both entities have a real, implicit state machine smeared across call sites. The pain
splits cleanly into two drift classes. Naming them is the whole point — they have
different cures, and conflating them is why past attempts flailed.

### Class A — internal representation drift
One logical rule is hand-re-encoded in two or more of: a **server guard `where`**, a
**client gating predicate**, a **SQL partial index**. They agree today; nothing forces
it. Every bug in both entity docs is this:
- membership `isAwaitingBgReview` exists **3×** (TS predicate, Prisma `where`, client copy);
- `IN_FLIGHT_*` status lists shadowed by partial unique indexes, synced by hand — a
  migration already had to hand-widen one to match a TS edit;
- `settledForComingYear` tested one way in the route, another in the sweep → a live bug
  (stray INITIAL activation flips a household's `validUntil` a year forward);
- enrollment has no *name* for its legal `(status, held, req, denied)` tuples, so a
  crash-stranded row is undetectable.

Cheap and fully solvable. The rule gets **one definition** that emits every encoding.

### Class B — external side-effect drift (the dual-write problem)
A DB row and an **external system** must move together but **cannot share a
transaction**: Shopify inventory `±1`, Shopify order/paid activation, Zoho contract
completion. Best-effort compensation (`+1`/`-1`, retry) papers over a *failed call*; a
**crash between the DB commit and the external call** strands state permanently, and no
amount of careful app code closes that window.
- enrollment invariant **I1** (`ACTIVE` with `inventoryHeldAt` still set) *is* this
  crash window — a `-1` that never comes back;
- membership's missed `orders/paid` webhook is this — activation that never happened.

This is the harder, more valuable problem. `lib/finance/reconcile.ts` already sweeps one
direction of it (recovering a missed activation by matching paid orders to pending rows).
It is a start, not the answer.

**This is not a state-machine-*library* problem.** An in-memory interpreter holds current
state and acts as the authority while it runs — but our authority is Postgres, mutated by
3–4 processes racing under rolling deploys running two code versions at once. An interpreter
cannot serialize that and would fight the DB for a job the DB already does (row locks +
compare-and-set). We need a **definition + validator**, not an engine.

---

## 2. The house pattern (what both machines converged on — ratify it)

Three layers. Authority stays at the bottom; the definition only *feeds* it.

1. **One declarative definition** per entity — the states, the transitions, the
   invariants — as a **dependency-free, client-safe data module**. Single source of
   "what is legal."
2. **Enforcement at the authoritative layer, unchanged.** Transitions are guarded by
   the existing compare-and-set `updateMany` (expected prior state in `where`), the
   `delete()`-as-atomicity-boundary idiom, the `SELECT … FOR UPDATE` locks, and the
   partial-unique-index + `P2002` catches. **The definition never replaces a lock or a
   conditional write.** A "transition" is a shared predicate + documentation, not an
   executed step. No interpreter is ever instantiated.
3. **Continuous reconciliation.** Because Class B side effects can't join the DB
   transaction, drift is *inevitable* and must be swept, not wished away — a
   validator/reconciler is a first-class layer, not an afterthought.

Layer 2 is the hard part and both entities already do it *well* — the compare-and-set
guards are correct concurrency engineering. What was missing is layers 1 and 3. A runtime
interpreter would have bolted on a *fourth* thing that competes with layer 2; we don't add one.

**Decisions, ratified for both machines:**
- **Dependency-free transition-table module** — states + predicates + a Prisma `where` per
  state-set, consumed by the guards. Not a runtime engine.
- **Definition layer, never runtime authority.** Postgres stays authoritative.
- **Derived-with-a-validator, not a persisted discriminator column.** The existing
  columns already *are* the state and are each independently load-bearing; a discriminator
  duplicates them and adds one more thing to drift, plus a migration on live data.

---

## 3. Shared vocabulary and one small framework

The two machines must read as one system. They already need the same two primitives —
so factor those into `src/lib/lifecycle/` and let each machine *instance* them. This is a
genuine shared need (two real consumers, identical emission logic), not speculative
abstraction.

### 3.1 `StateSet` — the Class-A anti-drift primitive
A named set of statuses (+ optional flag rule) that emits **both** a client-safe
predicate and a server Prisma `where` from the *same* source, so the two cannot diverge.

```ts
type StateSet<Row, Where> = {
  statuses: readonly string[];
  has(row: Row): boolean;        // client-safe predicate (booleans in, no Prisma)
  where: Where;                  // server Prisma fragment (type-only Prisma import, erased)
};
```

Membership uses it for `awaitingBgReview`, `IN_FLIGHT_*`, `grantableRenewalWhere`,
`settledThisCycleWhere`. Enrollment uses it for `PENDING_HELD`, `PENDING_HELD_DENIED`,
`PENDING_UNPAID` (the finance-queue / grace-cron / kick-cron filters).

### 3.2 `validate` / `classify` — the Class-B detection primitive
Given a row, return its named state or the invariant it violates. This is what makes a
crash-stranded row a *computable fact*.

```ts
classify(row): StateName | null;          // null ⟺ off-diagram
validate(row): { invariant: string } | null;   // which of the entity's invariants broke
```

Enrollment's I1–I4 are its `validate`. Membership has illegal combinations too (e.g.
`paidAt` set on an `INTAKE` row) and gets the same treatment.

### 3.3 `TRANSITIONS` — documentation + test oracle, never executed
The transition→enforcement-site table as data. Powers `isLegalTransition(from,to,kind)`
for tests and keeps the doc and the code honest. Not a runtime executor.

### 3.4 Client-safety rule (non-negotiable, from the membership doc)
The client bundle imports **zero** Prisma today, on purpose. `lib/lifecycle` and both
machine modules must stay client-importable:
- status/kind types are **local string-literal unions**, checked against the generated
  Prisma enum via a **type-only** `satisfies` — never a value import of the enum;
- predicates take booleans (`{ status, paidAt: boolean, … }`), not `Date | null`;
- `where` emitters are plain object literals typed against `import type { Prisma }`
  (erased at build);
- a dev/test assertion fails loudly if a schema enum key stops matching the local union.

**Ponytail watch-point.** The one place this framework risks over-engineering is a
*generic* `defineStateSet` over two different `WhereInput` types. If the generic gets
hairy, duplicating ~15 lines of emitter per machine is the lazier correct choice — share
the *convention* and the *test harness*, not necessarily the factory. Decide when we see
the second consumer's types, not now.

---

## 4. Class B strategy — where we should actually go

Layers 1 and 3 make drift *detectable*. To make the crash window *not happen*, adopt the
transactional outbox. This is the strategic recommendation neither entity doc commits to.

### 4.1 Transactional outbox (recommended direction)
In the **same DB transaction** as the state change, insert a row into an `outbox` table
recording the intended external effect ("owe Shopify `-1` on variant X for enrollment Y",
"activate on order Z"). The commit is atomic: either the state flip **and** the intent
land, or neither. A separate worker drains the outbox to Shopify/Zoho with retries and an
idempotency key, marking each row done only on success.

This kills the dual-write *class*, not one instance:
- no stranded hold — the intent to adjust Shopify is durable the instant the row moves;
- retries and crash-recovery are the worker's job, uniformly, instead of bespoke
  best-effort try/catch at every call site;
- `reportShopifyFailure` becomes "outbox row stuck past N retries," one alarm for all
  effects.

Scope is real (a table, a worker, idempotency keys) — this is a roadmap item, not this
sprint. But it is the correct destination, and every validator/reconciler we build now is
detecting a mess the outbox would stop creating.

### 4.2 Invariant-driven reconciler (near-term, cheap once `validate` exists)
A cron (`withCron`, same auth as the others) scans each entity for `validate` violations,
reports them to the existing sysadmin/board channel, and for the safe, unambiguous ones
(enrollment I1: `ACTIVE` + held → clear `held`, fire the missed `+1`) auto-heals. This
generalizes `lib/finance/reconcile.ts` from "order-driven recovery" to "invariant-driven
sweep." Build this right after the definitions; it's the payoff for having `validate`.

### 4.3 DB `CHECK` constraints (hardening, gated on a write refactor)
Encode the invariants as Postgres `CHECK`s so illegal tuples are *unwritable* — the
literal "Postgres is authoritative" endgame. Caveat already found in the enrollment doc:
I1 as a row constraint rejects the webhook's current **two-step** write (it commits
`status=ACTIVE`, then clears `held`; the intermediate committed row violates I1). Adopting
`CHECK` requires first collapsing those two writes into one `updateMany` — which the
outbox work makes natural anyway. Do it alongside 4.1.

---

## 5. Governance — how we keep ad-hoc flows from growing back

A definition only helps if new work is *forced* through it — and that forcing should be
**code**, not a rule reviewers must remember. The repo already enforces behavioral limits
this way (`pageRegistry` drift test, `routeAuthDrift`, `EDGE_INCLUDE_ALLOWLIST`); the machine
gets the same treatment. Almost all of "you can't grow an ad-hoc flow" is mechanizable:

- **Exhaustive classification — compile-time.** `classify` is a *total* function over the
  Prisma enum (an exhaustive `switch` with a `never` default). Add a status to the schema
  enum and the definition module **fails to compile** until it's handled. "A new status can't
  escape the definition" becomes a type error, not a checklist item. The §3.4 type-union ↔
  enum-keys assertion is the same lever for the local literal unions.
- **Status-literal allowlist — CI, mirrors `EDGE_INCLUDE_ALLOWLIST`.** A test greps for
  `ProgramParticipantStatus` / `OrgMembershipProcessStatus` string literals in query `where`s
  and asserts they appear **only** in the definition modules plus an explicitly-annotated
  allowlist of the CAS transition-guard sites (which keep their literal `where` on purpose —
  they encode transitions, not state-sets). A new raw `where: { status: … }` anywhere else
  fails CI, forcing it to either consume a `StateSet` or register as a transition guard with a
  justification comment — exactly how a new sensitive `include` must earn an
  `EDGE_INCLUDE_ALLOWLIST` entry today.
- **Typed transitions + reachability.** `TRANSITIONS` is typed against the status union, so an
  edge to/from a non-existent state won't compile; the reachability + exhaustive BFS checks
  (§6.1) fail if a status is orphaned or any legal path reaches an off-diagram state.
- **Index-parity test** (membership §7.2): `pg_indexes.indexdef` for each partial unique index
  must equal the `IN_FLIGHT_*` constant. Turns a hand-sync comment into an enforced check.
- **Validator oracle** (both): drive each transition against a real DB, assert the row
  `classify`es to the expected state and `validate`s clean; a simulated crash window must be
  flagged.
- **Generated machine artifacts** (§6.1): diagram / coverage matrix / reachability report
  checked in + CI-regenerated, so every machine-touching PR shows a diagram/matrix diff.

**The only irreducibly human part:** whether a genuinely-new `where` is a *duplicate of an
existing `StateSet`* or a *legitimately new transition guard*. The allowlist forces that
question into review; a person answers it. Everything above it is machine-checked.

---

## 6. Seeing and assessing the machine

The definition is **data** — and that is what makes the machine legible. You can diagram
it, enumerate it, diff it, and prove properties over it; none of that is possible for
guards smeared across routes. Two audiences, two sets of surfaces, **all generated from the
one definition** so they cannot disagree with the guards.

### 6.1 Review time — "is the complex machine really what we want?"

Generated artifacts, checked into the repo, regenerated in CI:

- **Diagram** — `stateDiagram` mermaid emitted from `TRANSITIONS`. Orientation. A drift
  test regenerates and diffs, so editing a transition without the picture updating fails
  CI. The diagrams already in the two entity docs become **generated artifacts, not
  hand-drawn** (and stop rotting).
- **Coverage matrix** — every `state × event` cell → target state or `—`. This is the
  primary review instrument, because **the blanks are the signal**: each `—` is a
  deliberate decision a reviewer ratifies (e.g. *"PENDING_HELD + non-payment-kick = —,
  correct: the kick cron's query excludes `isPaymentPlanRequested:true` rows; the grace
  cron owns them"*). A diagram hides absent edges; the matrix forces every one into the
  open — which is what "is this what we want" actually turns on.
- **Reachability report** — computed from the transition data: reachable-from-∅, terminal
  states, dead-ends (no outbound edge), unreachable states. Auto-flags dead states
  (membership's `RENEWAL_PENDING_BG` shows up as unreachable) so "is this dead?" is
  answered by the tool, not by grepping. The reviewer confirms the terminal set is intended.
- **Invariant list** — enrollment I1–I4 / the membership equivalents in plain English,
  beside the `validate` tests. Separates *"is this the right policy"* (a human ratifies the
  prose) from *"does the code obey it"* (the test proves it).
- **Exhaustive state-space check** — a BFS over the transition function enumerating every
  reachable `(status, flags[, kind])` tuple and asserting none violates an invariant and
  none is off-diagram. The space is bounded (hundreds–thousands of tuples), so this is
  model-checking **without TLA+/Alloy**: one dependency-free test proving *no sequence of
  legal transitions can reach a bad state*. Turns "we think it's right" into "we enumerated
  it."

**Review workflow.** Because the artifacts are checked in and CI-regenerated, a PR that
touches the machine shows the **diagram diff and matrix-cell diff** — *"this PR adds
ACTIVE→PENDING; a cell went `—`→`→PENDING`. Intended?"* The diff of a generated artifact is
the review surface, on every change. That assessability is exactly what scattered guards can
never provide.

### 6.2 Runtime — "what state is this row in?"

Derived, **never a persisted column** (a persisted `state` can drift from the columns that
drive behavior — visible but wrong). Instead, computed at read time and rendered:

- **`classify(row)`** renders the named state on demand in ops views — *"Membership:
  `PENDING_BG_REVIEW` — awaiting 2nd reviewer."*
- **`validate(row)`** surfaces off-diagram rows in System Status (same channel as Link
  Status) — the human face of the reconciler (§4.2).
- **SQL view** (or a Postgres `GENERATED` column) computing `classify` in SQL, so a DBA can
  `SELECT lifecycle_state FROM …` in a raw tool — derived, so it can't lie, but SELECTable
  like a column.

The review artifacts and all three runtime surfaces compute from the same definition as the
guards: picture, matrix, badge, and SQL view **cannot disagree**. "Humans can see it" and
"what they see is true" become the same property.

---

## 7. Roadmap

Sequenced so nothing behavioral moves until the inert pieces are proven.

| Phase | Work | Behavior change? |
|---|---|---|
| 0 | Both entity docs reviewed & approved (this doc ratifies the shared decisions). | none |
| 1 | `lib/lifecycle` primitives (`StateSet`, `TRANSITIONS`, `classify`/`validate` harness) + unit tests. Inert until imported. | none |
| 2 | Each machine's definition module instancing the primitives; refactor the query filters/guards to consume `StateSet.where`. Membership §7.4 (`settledForComingYear`) is the **one** intentional fix. | membership §7.4 only |
| 3 | Enforcement checks: status-literal allowlist test, index-parity + validator-oracle tests, generated diagram/matrix/reachability artifacts + exhaustive BFS check (§5, §6.1). Exhaustive `classify` is compile-time, lands with phase 1. | none |
| 4 | Invariant-driven reconciler (§4.2) + its human surfaces: `classify` badge, `validate` in System Status, SQL state view (§6.2). Generalizes `reconcile.ts`. | additive (heals + surfaces drift) |
| 5 | Transactional outbox (§4.1) for Shopify/Zoho effects; collapse two-step writes. | internal; closes the crash window |
| 6 | DB `CHECK` constraints (§4.3). | none (rejects only already-illegal rows) |

Phases 0–3 are the committed near-term (the two entity tasks). 4–6 are the strategic
direction this doc argues for and should be scheduled, not left implicit.

---

## 8. Explicitly out of scope / rejected

- **A runtime interpreter / execution engine** — wrong layer (§1); competes with the
  authoritative locks. The machine is a definition, not a driver.
- **TLA+ / Alloy / formal-methods tooling** — the bounded BFS check (§6.1) gets the same
  reachability/safety proof for our small state space with no dependency and no new language
  for reviewers to learn.
- **An interactive click-through machine inspector** — the generated diagram + coverage
  matrix cover review; a live explorer is YAGNI until someone actually needs to walk the
  machine interactively.
- **Event sourcing** — the correct end of the spectrum (append-only, no lost-update
  races, audit for free) but it rewrites how every entity persists. Right only if the
  temporal trail becomes the product. Not now.
- **Persisted discriminator column** — duplicates load-bearing columns; adds drift.
- **Routing the admin household toggle through the membership process spine** — it is a
  deliberate process-bypass (membership §4.5); the definition *documents* that, doesn't
  eliminate it.
- **`TODO(#278)` cart-attribute trust** at `webhooks/shopify/route.ts:103` — a separate
  security issue a state machine does not fix.

---

## 9. One-paragraph version (for the reviewer in a hurry)

Two entities, same disease: real state machines that live implicitly across server,
client, and SQL and drift apart. Two flavors — **internal** (a rule re-encoded by hand in
several places) and **external** (a DB row and Shopify/Zoho that must move together but
can't share a transaction). The cure is not a state-machine library; it's three layers: a
**single declarative definition** per entity (dependency-free, client-safe, emits both a
predicate and a Prisma `where`), the **existing compare-and-set + FOR UPDATE guards left
exactly as they are**, and a **reconciler** — moving toward a **transactional outbox** so
the external effect is durable in the same commit and the crash window simply stops
existing. Standardize the small shared framework in `lib/lifecycle` so the enrollment and
membership machines are two instances of one pattern, and put the drift alarms in CI so it
can't grow back. And because the definition is **data**, the machine is finally *seeable*:
a generated diagram, coverage matrix, and reachability report let reviewers assess whether
the complex machine is really what we want, an exhaustive state-space walk proves it never
reaches a bad state, and `classify`/`validate` render each row's live state without ever
persisting a column that could lie.
