# AT3 (#1254) — implementation notes

Decisions and deferrals from implementing AT3 (staff/household visit
management) on top of AT5 (PR #1357). The design itself is
[1256_ATTENDANCE_CORRECTION_SURFACE.md](./1256_ATTENDANCE_CORRECTION_SURFACE.md);
this file records the non-obvious calls made while building it, what shipped,
and what was deliberately left out.

**Left for later:** §4 (the open `isOperations` gate decision), the `SYSTEM`
enum-value drop (contract stage of §3), and the two items under "Also open".

---

## 1. The facility-open guard follows the SUBJECT, not the actor

**Where:** `src/app/api/attendance/manual/route.ts` (POST).

An **open** backfill — a manual entry with no departure time — asserts "this
person is in the building right now". It therefore obeys the same rule as
`/api/scan`: a non-keyholder cannot be the only person present, because someone
with a key had to open the door. If `activeKeyholders === 0` and the person is
not a keyholder, the write is refused with 403. A **closed** backfill is
historical and never gates.

Before AT3 the guard read `auth.user.isKeyholder` — the actor's session claim.
The route was self-only, so actor and subject were the same person and the
choice never mattered.

Once a household lead can insert for a member, it matters. Leaving the guard on
the actor allows: **a keyholder parent backfills an open visit for their
non-keyholder child into an empty building.** The child is then recorded as
present, alone, with no keyholder on site — exactly the state the guard exists
to prevent. This is a supervision invariant, not bookkeeping.

The rule now:

```ts
const subjectIsKeyholder = subjectId === userId ? auth.user.isKeyholder : subject.isKeyholder;
```

**Why the ternary instead of always reading the Person row.** For the self case
the session claim is what decided before, and switching that path to the DB row
is an unrelated behaviour change riding in on an AT3 PR. In production the two
agree — `src/lib/authClaims.ts` derives the claim from the Person row. In the
integration fixtures they do not: several tests set `isKeyholder: true` in the
session mock on a person row created without the flag, and went red when the
guard was first made DB-only. Self keeps the claim; proxy reads the row.

The guard is evaluated **inside** the advisory-lock transaction, so a racing
keyholder check-in is either committed-and-visible or not yet started.

---

## 2. Acting for a household member weights significance ×2 (`byProxy`)

**Where:** `src/lib/visit/significance.ts`.

Design §2's model is `significance = magnitude × source-trust-weight`, flagged
over a threshold of 90 weighted minutes. Source weights: `SCANNER` 3, `SYSTEM`
2, `WEB` 1, machine-close 0. Design §3 adds that a lead editing a member's visit
is itself a flag input — "an adult changing another person's record — factored
into significance."

Implemented as a multiplier on the final score when `actor !== visit.personId`.
Effect: the `WEB` flag threshold halves from a 90-minute shift to 45. A
50-minute nudge on your own self-reported arrival scores 50 and is noise; the
same nudge on your child's record scores 100 and emails the board.

**Why a multiplier, not the alternatives:**

- **Not a floor** (the rule deletes use). A floor flags *every* proxy edit,
  including a two-minute typo fix — the "required justification reads as
  distrust" failure §2 explicitly rejects. Friction, no signal.
- **Not a second weight table.** Doubles the tuning surface to encode one bit
  of information.
- A multiplier composes with the existing axes and stays **one constant** to
  calibrate when thresholds move to BoardSettings (§6.2).

**The interaction that decided it: multiplicative means source suppression
survives.** `MACHINE_CLOSE_WEIGHT = 0` → score 0 → `0 × 2 = 0`. A lead fixing
their child's `AUTO_CLOSE` departure — cron stamped midnight, the child actually
left at 4pm, an eight-hour correction — still scores 0 and never flags. An
additive proxy weight would make that happy-path fix the loudest alert in the
system, the exact inversion §2 warns against. Pinned by the test
`never resurrects a machine-close correction`.

For deletes the multiplier only moves the score (deletes always flag by the
floor). That score is what AT12 will rank its feed by, so a lead deleting a
scanned visit outranks a member deleting their own web entry.

---

## 3. DONE — the `VisitSource` 3-way split (shipped in this PR)

Issue #1254 item 4, design "Terminology" + §3. `SYSTEM` splits into
`LEAD_MARKED` / `FACILITY_CLOSE` / `AUTO_CLOSE`, one value per current writer:

| writer | was | now |
|---|---|---|
| events-attendance roster mark | `SYSTEM` (both fields) | `LEAD_MARKED` |
| keyholder building-close `closeAllOpenVisits` | `departedVia: SYSTEM` | `FACILITY_CLOSE` |
| nightly-cron sweep `processVisitCheckout` | `departedVia: SYSTEM` | `AUTO_CLOSE` |

**It is not a security-boundary change**, contrary to the design's own
Security-boundary note (now corrected in that doc). `classifications.ts` tiers
*fields*, not enum values: `arrivedVia`/`departedVia` are `public` regardless of
the value set, so adding values regenerates the file byte-identical — verified
by adding the values, regenerating, and diffing to empty.
`security-boundary-isolation.yml` fires only on `src/security/**` (excluding
`generated/`), the generator script, or a re-tier of an existing field. Design
§3 was right that it belongs in the AT3 PR.

**Shipped as expand-only, in two migrations.** `SYSTEM` is **kept in the enum**.
During a rolling deploy the previous release serves traffic against the
fully-migrated schema and still writes `SYSTEM` from all three paths above;
dropping the value would 500 every one of them for the whole drain window.
Dropping it is a follow-up release (the contract stage), once no deployed code
can write it.

- `20260803000000_visit_source_split_add` — three `ALTER TYPE … ADD VALUE`.
  Deliberately **not** wrapped in `BEGIN`/`COMMIT`: Postgres forbids *using* a
  value in the transaction that added it. The statements are additive and
  idempotent, so a partial apply is harmless.
- `20260803000100_visit_source_split_backfill` — the row mapping, wrapped,
  because its two updates must land together.

**The legacy mapping, and the one case that is recoverable.** `departedVia =
SYSTEM` is fused history — the discriminator between "building closed" and "cron
swept you" was never stored. But the roster mark is the only writer that puts
`SYSTEM` on *arrivedVia*, and it writes both fields together, so a
`SYSTEM`/`SYSTEM` pair is unambiguously a lead mark. Everything else falls back
to `AUTO_CLOSE` — the conservative "don't trust this departure" reading, which
also makes those rows source-suppressed in the significance rule rather than
flagging their corrections to the board. Verified against seeded legacy rows:

| before | after |
|---|---|
| `SYSTEM` / `SYSTEM` | `LEAD_MARKED` / `LEAD_MARKED` |
| `SCANNER` / `SYSTEM` | `SCANNER` / `AUTO_CLOSE` |
| `WEB` / `WEB` | unchanged |

**What the split bought.** `src/lib/visit/significance.ts` no longer has to
*infer* a machine close for new rows — the source says so outright. The
inference branch survives for legacy `SYSTEM` only and dies with the value in
the contract release. `facility/trends` now excludes
`arrivedVia ∈ {LEAD_MARKED, SYSTEM}` — the legacy spelling stays in the list for
the same drain-window reason, and there is an integration fixture pinning both.

---

## 4. NOT DONE — open decision §6.1: widen the `facility/visits` gate to `isOperations`

The gate stays `['isSysadmin', 'isBoardMember']` on all four verbs
(`GET`/`POST`/`PATCH`/`DELETE`) and on the page (`useRequireRole` in
`src/app/facility-ops/visits/page.tsx`).

Design §6.1 recommends **yes** — ops is a facility-operations role and visit
management is facility operations — but lists it as an open board decision.
Widening a permission gate is not a default worth taking silently, so it was
left at the status quo.

**If adopted:** ops moves from 🟡 to ✅ in the §1 matrix, and the same 3-role set
must be applied to **both** the route (`withAuth roles`) and the page
(`useRequireRole`) together — the two sets must stay equal, since their drifting
apart is exactly what AT13 (#1259) was.

---

## Also open (raised during implementation, not addressed)

- **Audit-fidelity window in `manualEditAttendance`'s Absent branch**
  (`src/app/api/events/[id]/route.ts`). It was one atomic `deleteMany`; it is now
  `findMany` → `$transaction([updateMany, createMany])`. The `updateMany` carries
  `LIVE_VISIT`, so a row someone else tombstones in the gap is correctly skipped
  — but `createMany` still writes a DELETE audit row for it, crediting this lead
  with a deletion they did not perform. Wrong actor on one audit row; never data
  loss or a resurrected tombstone. The proper fix is the advisory lock, below.
- **Pre-existing: two visit-write paths take no advisory lock at all** —
  `PATCH`/`DELETE /api/facility/visits`, and the whole `manualEditAttendance`
  branch. Design §5 states the invariant as *every* visit write (self, staff,
  automated) going through the advisory lock plus the one-open-visit guard,
  precisely so a correction cannot race the facility-close sweep (the AT9/#254
  convergence). Both predate this branch.
