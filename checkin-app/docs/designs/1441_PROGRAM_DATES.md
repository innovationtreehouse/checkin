# Program dates: a required start, a bounded end

**Issue:** #1441 · **Backlog:** P33 (policy divergence) · **Status:** design. No
production code accompanies this doc.

Policy says a program has a start date and an end date. The schema says both are
optional (`Program.startAt`/`endAt` are `DateTime?`) and no write path rejects a
program that has neither. The fix is two changes at the write boundary, not a
schema rewrite:

1. **Both dates are required** — validated in one shared function called by every
   writer, plus `required` on the create form's two date inputs.
2. **Legacy nulls stay legal in the database** and are fixed by hand. The one
   place where a missing date is a safety question — the age gate — fails closed
   instead of silently substituting "now".

The backlog entry proposes a third rule, defaulting an absent end to
fiscal-year-end. §2 explains why this design requires the end instead.

The column stays nullable through this phase. Making it `NOT NULL` is a later,
separate release and is spelled out in §6.

---

## 1. What the code does today

| Field | Type | Writers | Validation |
|---|---|---|---|
| `Program.startAt` | `DateTime?` | `POST /api/programs` ([route.ts:216](../../src/app/api/programs/route.ts)), `PATCH /api/programs/[id]` ([route.ts:234](../../src/app/api/programs/[id]/route.ts)) | none |
| `Program.endAt` | `DateTime?` | same two | client-side only: the create form disables submit when `endAt < startAt` ([program-ops/new/page.tsx:42](../../src/app/program-ops/new/page.tsx)) — no server check |

Both are stored as UTC-midnight calendar dates through `parseDateOnly`
([time.ts:106](../../src/lib/time.ts)), the convention set by the #1149 date/time
design. This design keeps that convention and adds nothing to it.

The settings route is dead code (#477 — never called), but it writes these
columns, so it gets the validator too. A dead route that can be revived without
the rule is a rule that isn't enforced.

### The three rules that change meaning while the dates are absent

**(a) Age eligibility falls back to the request moment.** `checkProgramAge`
takes `asOf` and both callers pass `program.startAt ?? undefined`
([programs/[id]/page.tsx:125](../../src/app/programs/[id]/page.tsx),
[participants/route.ts:123](../../src/app/api/programs/[id]/participants/route.ts)).
When `startAt` is null, `calculateAge` defaults `asOf` to now
([time.ts:126](../../src/lib/time.ts)) — so a program with `minAge: 13` admits a
twelve-year-old who turns thirteen next week if they register on their birthday,
and refuses one who was thirteen on the first day of a program that already
started. Judging age as-of the program start is the entire reason `asOf` exists;
a null start silently turns it off. This is the safety-adjacent one.

**(b) The catalogue reads a missing end as running forever.** The `active=true`
filter is `OR: [{ endAt: null }, { endAt: { gte: now } }]`
([programs/route.ts:84-89](../../src/app/api/programs/route.ts)), so a dateless
program from two years ago is permanently "active". The public and member views
print `' (Ongoing)'` for the same rows
([programs/page.tsx:131](../../src/app/programs/page.tsx),
[my-activities/programs/page.tsx:116](../../src/app/my-activities/programs/page.tsx)).

**(c) Member pricing falls back to status alone.** `programCoverageDate` returns
`endAt ?? startAt ?? null`
([orgMembership.ts:203](../../src/lib/orgMembership.ts)), and `coversThrough`
treats `null` as "no duration question — pass"
([orgMembership.ts:169](../../src/lib/orgMembership.ts)). A dateless program
therefore gives the member discount to a household whose dues expire at the next
boundary, no matter how long the program runs. Three consumers ride on that
value: the discount-code mint
([discount-code/route.ts:39](../../src/app/api/programs/[id]/discount-code/route.ts)),
the program detail route
([programs/[id]/route.ts:37](../../src/app/api/programs/[id]/route.ts)), and the
announce blast ([notifications.ts:102](../../src/lib/notifications.ts)).

Note what (c) means for this design: **fixing the dates fixes the pricing bug for
free.** No pricing code changes here. Once `endAt` is always populated,
`programCoverageDate` never returns null for a new program and the existing
coverage check does its job.

---

## 2. D1 — Both dates are required, enforced server-side

One exported validator, called by all three writers, alongside the existing
`validateProgramAgeBounds` pattern:

```ts
// src/lib/programDates.ts
export function validateProgramDates(
  startAt: Date | null,
  endAt: Date | null,
): string | null {
  if (!startAt) return "Start date is required";
  if (!endAt) return "End date is required";
  if (endAt.getTime() < startAt.getTime()) return "End date cannot be before the start date";
  return null;
}
```

Each writer computes its *effective* values first (body value if present, else
the row's current value), exactly as the settings route already does for
`minAge`/`maxAge` — otherwise a one-sided PATCH that clears `startAt` slips past
a check that only looks at the body.

The create form gets `required` on both date inputs
([program-ops/new/page.tsx:146,154](../../src/app/program-ops/new/page.tsx)). The
form's existing `datesInvalid` check stays; the server rule is the one that
counts, and the form check is the one that reads well.

### Rejected: defaulting an absent end to fiscal-year-end

The backlog entry proposes materializing a missing end as the end of the fiscal
year containing the start. Rejected, for three reasons.

**It writes a date that is almost never true.** Programs run a term — six weeks,
a semester, a summer. A fiscal-year-end stamp is a fabricated date sitting in a
column that reads as a fact, and unlike a null it doesn't look like one.

**The fabricated date then drives money.** `programCoverageDate` prefers `endAt`,
so a six-week autumn program stamped through the following May would demand
membership coverage through May and refuse the member discount to a household
whose dues are settled for the current year — the exact case the coverage rule
exists to *allow*. Requiring the real end is what makes that check correct;
inventing one makes it wrong in a new direction.

**It buys a dependency for nothing.** The default's only possible input is
`BoardSettings.orgMembershipYearBoundary`, which is nullable
([schema.prisma:528](../../prisma/schema.prisma)) — so the writer would still
have to refuse when it isn't set. A rule that can't answer without a board
setting, and that produces a wrong answer when it can, is worse than a required
field.

This also removes the "is the fiscal year the membership year?" question from
this design's path. It remains #1484's to answer, where a *real* spanning end
date is the input.

### What an open-ended program does

A standing club or an always-on offering has no natural end, and D1 gives it no
escape hatch. It doesn't need one: pricing is set per fiscal year, so such a
program is repriced at the boundary anyway, and its end date lands there
naturally. What continues across the boundary is the *people*, not the program
row — carried by the roster copy in #1513, which is where the continuity problem
actually belongs.

---

## 3. D2 — The age gate fails closed on a dateless program

Legacy rows keep their nulls, so the age fallback in §1(a) survives this design
unless it is closed explicitly. Close it inside `checkProgramAge`, not at the two
call sites, so both the client member-select and the server enroll route get it
from one edit:

```ts
// src/lib/programAge.ts
export function checkProgramAge(
  person: { dateOfBirth: Date | string | null; isDeclaredAdult?: boolean },
  program: { minAge: number | null; maxAge: number | null; asOf?: Date | string },
): ProgramAgeResult {
  const { minAge, maxAge } = program;
  if (minAge === null && maxAge === null) return { ok: true };
  if (!program.asOf) return { ok: false, reason: "dates", label: "Program dates missing" };
  // …unchanged
}
```

The order matters: the `minAge === null && maxAge === null` early return stays
first, so an ungated program is unaffected by a missing start date. Only a
program that actually gates on age refuses, and it refuses with a message a lead
can act on. `AgeReason` gains `"dates"` and `ProgramAgeResult`'s label union gains
`"Program dates missing"`; both are narrow unions, so `tsc` finds every consumer
that switches on them.

This is the one behavioral regression in the design: an age-gated legacy program
with no start date stops accepting enrollments until someone sets its dates.
That is the intended pressure — it is a small, countable set (§5) and the
alternative is admitting people against an age bound nobody evaluated.

---

## 4. D3 — What does *not* change

- **Pricing and coverage code.** Untouched. See §1(c).
- **`programYear.ts`.** No fiscal-year helper is added; see §2.
- **The `{ endAt: null }` branch** of the catalogue filter and the `' (Ongoing)'`
  copy. They still describe legacy rows correctly, and the cleanup that makes
  them unreachable is quick (§5), so they come out whole in the `NOT NULL`
  release (§6) rather than being partly disarmed now.
- **`programCoverageDate`'s null return.** Same reason.
- **`Event.startAt`/`endAt`.** A different model, already non-null, out of scope.

---

## 5. D4 — Legacy rows are fixed by hand, not by migration

There is no honest machine answer for what a dateless program's dates were.
`Program` has no `createdAt`, and reconstructing one from its `AuditLog` `CREATE`
row would produce a date that looks authoritative and is really the moment a
board member filled in a form. Age eligibility is judged against this value, so
a plausible-looking wrong date is worse than a null.

Ops instead gets the list:

```sql
SELECT id, name, "startAt", "endAt", "minAge", "maxAge", phase
FROM "Program"
WHERE "startAt" IS NULL OR "endAt" IS NULL
ORDER BY "minAge" IS NULL, id;
```

Age-gated rows sort first because those are the ones D2 has stopped accepting
enrollments for. Every row is edited through the existing program settings form.
No new UI: the query may well return nothing, the cleanup is a single sitting,
and a screen built to be used once and then be wrong is worse than a query in a
doc.

Two forces drain the set on their own. The PATCH validator (D1) runs on
effective values, so the next save of any legacy program requires both dates. And
D2 makes an age-gated dateless program visibly broken rather than quietly wrong.

---

## 6. Rollout

**This release (issue #1441)** — `src/lib/programDates.ts` with
`validateProgramDates`; the three writers call it; `required` on both create-form
date inputs; the `checkProgramAge` fail-closed branch. **No migration.** Every
change is at the write boundary, and the column stays nullable, so old instances
serving traffic mid-deploy write nulls into a column that still accepts them.

**A later release, after the §5 list reaches zero (#1514)** — `SET NOT NULL` on both
columns, then delete the `{ endAt: null }` filter branch, the `' (Ongoing)'` and
`'Start Date TBD'` copy, and `programCoverageDate`'s `?? null` tail. This is a
separate release because of the rolling-deploy drain window
(`docs/DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md`): during the drain, instances
running the *previous* build serve traffic against the fully migrated schema. A
`NOT NULL` that lands while any un-validated writer is still up turns a form save
into a 500. The ordering rule is: validators everywhere → backfill to zero →
`NOT NULL` → delete the null-handling readers.

`Program.startAt`/`endAt` are `@sensitivity:public` and stay so; nothing here
touches the security boundary, so no isolated-PR requirement applies.

---

## 7. Interlocks

**#1484 (declare the fiscal year at program creation)** gets its input from this
design. Its case is a program *spanning* the membership-year boundary, where
inferring the year from dates is ambiguous and the board must declare it. That
question only has meaning once every program has a real, bounded end date to
span with — which is what D1 guarantees. This design deliberately does not
model a fiscal year (§2); #1484 owns that field, and `programCoverageDate` is
where it will plug in.

**#1513 (copy participants between programs)** carries the continuity this
design's bounded end dates hand off. A program that runs year after year ends at
the fiscal-year boundary and starts again as a new row; what has to survive is
the roster. That issue also raises the structural version — a persistent
"ongoing program" tier *above* `Program`, owning the yearly rows beneath it.

**#1361 (ProgramInstance restructure)** moves `startAt`/`endAt` to the instance
([PROGRAM_INSTANCE_RESTRUCTURE.md:90](PROGRAM_INSTANCE_RESTRUCTURE.md)). The
validator lives at the write boundary, so it moves with the columns and its
signature does not change. Landing this first is not wasted work; landing the
`NOT NULL` half of §6 mid-restructure would be, so sequence that half after the
restructure's M3. An instance is a run *within* a year, so it is not the tier
that answers year-over-year continuity — see #1513.

**#1149 (date/time canonical layer)** owns the UTC-midnight calendar-date
convention these fields already follow. Nothing here adds date arithmetic.

**#1421 / #1370 (dues-settled pricing, unified signup)** consume
`programCoverageDate`. They get a non-null value for free once D1 ships; nothing
here changes their contract.

---

## 8. Tests

- **Unit, `programDates.test.ts`** — missing start rejected; missing end
  rejected; end before start rejected; equal dates accepted (a one-day program).
- **Unit, `programAge.test.ts`** — an age-gated program with no `asOf` returns
  `{ ok: false, reason: "dates" }`; an ungated one with no `asOf` still returns
  `{ ok: true }`.
- **Integration, `programsAPI.integration.test.ts`** — `POST /api/programs`
  without `startAt` is a 400; without `endAt` is a 400; a PATCH clearing either
  date is a 400.

No flow test. Nothing here spans a journey the existing program flow tests don't
already cover, and the rules are all synchronous validation.
