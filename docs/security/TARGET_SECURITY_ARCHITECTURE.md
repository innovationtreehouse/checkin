# Target security architecture

**Status: PROPOSED. A from-first-principles design for data visibility in
this app, informed by (not anchored to) the shipped handler system and issue
#1134. Open decisions are in [Open issues](#open-issues); everything else in
this document is the recommended design.**

## The problem, stated without reference to the current code

The app holds membership and attendance data for an organization that
includes children: names, dates of birth, home addresses, emergency contacts,
family narratives written for safeguarding review, background-check state,
and who is physically in the building right now. Callers range from anonymous
catalog browsers through household members, program staff, keyholders, and
board, to a kiosk and outbound channels (email, Shopify).

Two facts about visibility, and they are different in kind:

- **Field sensitivity is intrinsic.** `Person.email` is contact PII no matter
  which route ships it. One classification, enforceable everywhere.
- **Row visibility is contextual.** The same `Program` row is visible to
  anonymous on the catalog, to its lead while draft, and to board in ops
  views. It is a function of route purpose × caller relationship × business
  lifecycle, and the relationships involved (own row, own household, own
  program's participants) are all derivable from foreign keys in the same
  database.

The threat model, in priority order, based on every incident to date:

- **T1: a well-intentioned PR leaks data.** The dominant, proven class:
  field over-return (#129), error-response leaks (#127, #122), row
  over-return (P0-C, #575). The contributors are increasingly AI agents
  producing plausible-looking code, and review alone has repeatedly
  failed to catch this class.
- **T2: a route bypasses the security layer entirely** (forgot the wrapper,
  reached for the session directly). Has re-grown once already (#580).
- **T3: an authenticated user probes.** IDOR on ids, enumeration, aggregate
  and status-code side channels (row existence, counts).
- **T4: the app layer is subverted** (SQL injection, a dependency bug, a
  compromised process). No app-layer control survives this; only the
  database's own enforcement does.

Out of scope: a malicious maintainer, infrastructure compromise.

The constraints: Next.js + Prisma + Postgres, live production data, a small
team, no appetite for standing services, and a hard requirement that the
policy itself be **auditable as a unit**, readable in one reviewed place, by
two distinct audiences:

- **Maintainer review** (CODEOWNERS + boundary-isolation CI): every change
  to what data can leave, and to whom, is an isolated, reviewable diff. This
  exists because of T1: when the code author is an agent, the human
  reviewer's effort is best spent on a small policy surface, not on
  re-deriving each route's security by hand.
- **Governance review**: the organization's board is accountable for
  safeguarding data about children and families. The policy must be
  renderable in plain language ("program leads can see the emergency
  contacts of households whose children are in their programs, but not
  their home addresses") without anyone reading code. No query syntax, ORM,
  or policy DSL is governance-reviewable; only a derived plain-language
  statement is.

The second audience is a hard filter on mechanism choice: whatever the
engine, **the policy must exist as data from which a human-readable report
can be generated**. Query-builder code (Kysely-style SQL chaining), however
sound as machinery, can never be the review surface; under this design it
never is, because engines are verified by tests and the only thing any human
reviews is the declaration.

## The model space

Four established families solve this class of problem. Judged against T1–T4
and the constraints:

**1. Per-view serializers / DTOs** (Rails pundit+blueprinter, DRF
serializers): each route × role gets an explicit allowlist mapping. Safe by
construction at the field level, because you cannot leak a field you never
mapped, and simple. But it fails the audit requirement: policy is scattered
across N serializers, which is exactly the disease that produced
#129/#127/#122 here. Rejected as the organizing model. Its virtue, **allowlist
by construction rather than denylist by subtraction**, is the single most
important property the target design must steal.

**2. Externalized relationship-based access control** (Zanzibar: SpiceDB,
OpenFGA, Ory Keto): model "caller may X row" as a relationship graph in a
dedicated service. The *abstraction* is exactly right; this app's scope
vocabulary (`their_own`, `their_households`, `their_program_participants`, …)
is a hand-rolled ReBAC, and that is the correct shape for the domain. The
*deployment* is wrong for one app on one database whose relationship tuples
are already the FK graph: an external tuple store adds infrastructure, a
consistency problem (the graph lagging the DB), and a second source of
truth, and buys nothing a same-DB join doesn't already provide. Rejected;
keep the vocabulary, skip the service.

**3. In-process policy engine over the ORM** (ZenStack for Prisma; CASL,
Oso): declare access rules once; an enhanced client **injects row filters
into every query and confines reads to permitted fields, by construction**.
This is the industry-consensus enforcement point for this exact stack:
policy compiles into the query, so a forgotten `where` or an over-wide
`select` is not writable. ZenStack is this productized: schema-level
`@@allow` rules with relation traversal, an enhanced client, field-level
read policy. The model is right. Whether to *adopt the dependency* is a
separate question (settled in "Build vs adopt"); the current system is best
understood as a hand-rolled, partially-built member of this family with the
enforcement half missing.

**4. Postgres row-level security**: policies in the database, keyed on
per-request session context. The only layer that survives T4, and the only
one that also covers non-route readers (jobs, future server components, a
stray script). The costs are real on this stack: per-request context through
Prisma's connection pooling requires wrapping every query in a transaction
that sets a GUC; policies are written in migrations, a second policy
language to keep consistent with the app's; dev/test parity needs care; and
RLS cannot express field tiers or route context, so it can never be the
whole answer. Correctly scoped, it is a **backstop for the handful of tables
where a leak is catastrophic** (minors' PII, safeguarding narratives, visit
presence), not the primary mechanism.

**The verdict.** The right model for this app is family 3 with family 2's
vocabulary: **a single declarative policy (tiers for fields, relationship
scopes for rows, declared per route) that compiles into the query**, so
that both the row filter (`where`) and the field set (`select`) are derived
from policy rather than hand-written and then checked. Family 4 is a
targeted addition beneath it, decided per-table. Response-time enforcement
(stripping) survives only as a tripwire, not as the mechanism.

## What exists, and what it teaches

The shipped system (handler/registry/stripper) and issue #1134 each hold
half of this verdict.

What the current system got right, and the target keeps:

- **Policy as reviewable data.** Tiers in the schema, grants in one
  registry, CODEOWNERS + single-PR boundary isolation. This is the T1
  mitigation and it is the part worth the most.
- **The scope vocabulary.** Seven relationship scopes, bound per model in
  `SCOPE_BINDINGS`, resolved from a per-request `CallerContext` with
  derived, fail-closed prefetch (`ctxNeeds`). ReBAC-lite over the FK graph:
  correct abstraction, correct location.
- **The equivalence-test discipline.** Every representation change carries a
  behavior-neutrality proof (`scopeBindingsEquivalence`, `ctxNeeds`). This
  habit transfers to every seam the target adds.
- **Fail-closed defaults**: unregistered endpoint → 500; row-scoped model
  missing its scope key → no scopes at all.

Where it deviates from the verdict; these are structural, not tuning:

- **Enforcement happens at the response, not the query.** Routes hand-write
  `select` and `where`; the stripper subtracts afterward. The two-layer
  redundancy itself is legitimate defense in depth. The defect is that one
  of the copies, the hand-written select, has no declared source of truth,
  so when the layers diverge nothing can *detect* it: a stripper pass
  silently masks an over-fetch, sensitive rows transit process memory, and
  nothing checks that a select even includes the FK fields its scopes match
  on. The target keeps the two-layer evaluation and makes disagreement
  observable (the tripwire, below); what it removes is the unverifiable
  hand-written copy.
- **Row visibility has no mechanism at all**: hand-rolled `where` clauses,
  human review, and a prose allowlist (`EDGE_INCLUDE_ALLOWLIST`). P0-C and
  #575 shipped through this gap. #1134's diagnosis, that rows must be
  filtered query-side, is correct and is half of the verdict above.
- **Coverage is the binding constraint.** About 19 registered endpoints
  across 14 of 142 route files; **116** files call `withAuth` (measured
  by call sites, not string mentions; 5 use the generic `withAuth<T>(`
  form that naive greps miss), **7** files are dual-wrapper (a
  `handler()` GET beside `withAuth` write verbs, so they migrate
  per-verb), and the distinct session-authenticated surface is **123**
  files, guarded outside the registry by a regex scan, a guard class
  this repo has already watched fail three times
  (`livePersonDriftGuard`, per #1456). Every guarantee any of this
  machinery provides applies only to the registered surface.
- **Aggregates are dishonest.** `_count` values are computed over the
  unfiltered relation; the stripper gates only whether the number is shown.
  Only query-side filtering can make a count true.
- **#1134 stops short of the verdict.** It moves rows to the query (right),
  keeps fields at the response (inherited), makes the builders opt-in with
  tests as the only guarantee, and defers by-construction enforcement to an
  undefined "if 1–2 keep leaking" trigger. Tests are a floor, not a
  mechanism: a test-enforced invariant holds only where someone declared
  and fixtured it; a constructed invariant holds everywhere the constructor
  is used.

## The target design

### Invariants

| # | Invariant | Enforced at | Proved by |
|---|---|---|---|
| I1 | A field reaches a caller only if their view grants its tier on a row where they hold the scope | the query's select, **generated from the caller's resolved view** (construction); stripper handles only per-row scope subsetting within that view | field contract tests (shipped) |
| I2 | A row reaches a caller only if they hold a declared row relationship for that route | the query's **generated where** (construction) | persona row-contract walker + `rowFilterEquivalence` |
| I3 | Aggregates and existence signals (counts, 404-vs-403) are computed over the I2-filtered set only, except counts a route explicitly declares public (see Aggregates) | the query | walker assertions |
| I4 | A mutation touches a row only if the caller holds a declared act-on relationship | route `where`/ownership composed from the same fragments | walker driving writes as personas |
| I5 | Caller-independent lifecycle exclusions (tombstone, archive) apply structurally, below the permission layer | the same query-construction point | facade injection tests: every read of an excluded-lifecycle model carries the exclusion fragment |

### The mechanism: the registry compiles into the query

The registry already contains everything needed to construct a route's
query, not merely to check its output:

- `rows:` (per #1134) + `SCOPE_BINDINGS` + `CallerContext` → the **`where`
  fragment** for each returned model (`rowsWhere`, fail-closed: an unbound
  scope throws).
- The **caller's resolved view** (first-match on roles, known before the
  query runs), unioned over the scopes that view can hold, intersected with
  the model's classifications, plus the scope-key FK columns the bindings
  need → the **per-view `select`** for each model. A low-privilege caller's
  request never fetches a higher role's field bands at all; role-band
  separation is a property of the SQL, not of a JavaScript pass downstream,
  so an error serializer, a debug log line, or a response assembled before
  the stripper runs cannot observe what the caller's view does not grant.
  (A per-*route* union select would reintroduce subtraction-after-fetch for
  every mixed-role route; the view is resolvable pre-query, so nothing
  forces that.)

The route-facing API becomes a scoped read facade; the registered endpoint's
handler receives a query object already carrying policy:

```ts
export const GET = handler('GET /api/programs/mine', async ({ db, ctx }) => {
    // db is scoped: where and select for ProgramParticipant are already
    // composed from the registry entry. The route may narrow (business
    // rules), never widen.
    const rows = await db.programParticipant.findMany({
        where: { status: 'ACTIVE' },          // narrowing only
        orderBy: { createdAt: 'desc' },
    });
    return { ProgramParticipant: rows };
});
```

Properties this buys, none of which subtraction-after-fetch can:

- A forgotten row filter is **not writable**: the caller-relationship
  `where` is present before the route adds anything.
- An over-wide select is **not writable**, and sensitive rows never enter
  process memory beyond what the caller's view may see.
- Scope-key columns are auto-included, which ends the silent missing-key
  failure class.
- `_count` and pagination are computed over the filtered set: I3 falls out.
- Lifecycle exclusions of the `LIVE_PERSON` class compose at the same
  point (I5). #1456 pursues its own endgame independently (removing the
  tombstone outright) and deliberately declines coupling with this work;
  the facade's injection site is an offer to whatever caller-independent
  exclusions remain, not a dependency in either direction.
- Every governed read passes one point that knows the caller, the model,
  the admitting scope, and the row count, so **the facade records reads of
  the highest-tier models**, and a per-caller daily volume threshold raises
  a review. Access control answers "who could see"; a safeguarding inquiry
  always asks "who *did* look." A program lead paging through every
  household in their program is fully authorized on every request; only an
  access log distinguishes that from looking up one emergency contact
  because a child is hurt, and the log's value is entirely in history that
  must exist before the question is asked.

**`asSystem()` is a governed door, not a greppable one.** Every escape from
the scoped facade names a **registered entry in a CODEOWNERS-gated
inventory**, a key plus a justification, and an unknown key fails at
registration, not in review. The lesson of `EDGE_INCLUDE_ALLOWLIST` is not
that allowlists fail; it is that an allowlist consulted by habit fails, and
one the code will not run without does not. Every inventory entry renders
into the governance report under an explicit heading: these reads are not
governed by the policy. If that list is uncomfortable to show the board, the
discomfort is the control working. Cron jobs are system-context by nature
and appear in the same inventory.

**The stripper is retained as the second, independent evaluation, and its
disagreement is the tripwire.** In the target, **one declaration is
evaluated twice by deliberately independent engines**: compiled into SQL and
evaluated by Postgres on the way in, and resolved per-row in JS
(`scopesHeld`) on the way out.

With the select compiled from the caller's view, the tripwire condition is
nearly binary. On a route whose view carries a single scope, the stripper's
expected output is the identity function; any removal at all alarms. On a
mixed-scope view (`their_own:pii` alongside
`their_program_participants:pii`, where a bag can hold rows for which the
caller holds one, the other, or neither), SQL cannot vary columns per row,
so a residual expected removal remains: within-view, per-row scope
subsetting. That residual carries a residual risk, stated plainly: the
expected-removal computation is the resolver's own job, so a resolver bug
can produce a wrong expectation that matches its own wrong removal. Two
controls bound it. Single-scope routes, most of the registry, get the
binary condition; and a **scheduled canary**, a synthetic request against a
deliberately inconsistent declaration, asserts the alarm still fires,
because an alarm designed never to fire is otherwise indistinguishable from
a broken one after a quiet year.

The alarm semantics split along the residual. **Where the expected-removal
set is empty (single-scope views), an unexpected strip fails the response
closed**; a never-should-happen condition costs no availability, because a
correct system never reaches it. **Where the expected set is nonempty
(mixed-scope views), the tripwire alarms without failing**; a comparison
that can itself be wrong must not be able to take a route down. Which case
a route falls into is derived from its declaration, never chosen by the
author. Both log the route and declaration, never the data. A disable
switch exists for incident use; its state renders into the governance
report, so leaving it off is visible to someone other than the person who
turned it off.

To be precise about what this catches: a wrong *declaration* passes both
engines identically. No runtime check can catch declared-but-wrong policy;
that is what CODEOWNERS, the governance report, and the walker's fixtures
are for. What the tripwire catches is everything downstream of the
declaration: a where-compiler bug, a resolver bug, stale generated
classifications, a missing scope-key column, a filter-composition bug. Each
appears as engine disagreement **on live data**, which makes the tripwire
the equivalence test running against every production row forever rather
than against fixtures once. The residual risk is common-mode failure, which
yields a standing design rule: **the query-side compiler and the
response-side resolver share the declaration data but must never share
evaluation code.** Their independence is the defense-in-depth property; a
refactor that merges them removes the tripwire's reason to exist.

**Business rules narrow, scopes bound; this is settled practice, not a
local invention.** Every mainstream authorization layer defines policy as an
**upper bound with default deny**: the policy answers "may this caller see
this," the application is always free to show less, and nothing lets it
show more. Postgres RLS policies bound what a query can return while the
query's own `WHERE` narrows further; Cedar/OPA render permit/deny decisions
that application filtering composes under; Zanzibar `check()` gates and
product code filters on top. No mainstream authz system asks the policy to
be the *exact* result set; "exact" belongs to contract testing, not access
control. The same bodies of practice draw the line for what must be *in*
the policy: a rule is authorization, not business logic, precisely when it
protects confidentiality from a viewer. That is this design's graduation
criterion restated: **if forgetting the rule is a leak, it is policy and
must be a scope**; if forgetting it is a product bug, it stays route code
with per-route tests.

The first graduations are decided: **two membership scopes, not one**.
`org_members` (membership ACTIVE: dues paid *and* background check cleared)
gates member benefits. `dues_settled` (the wider #1397 predicate covering
paid-awaiting-review households) is valid for program visibility and
pricing only, never for anything implying a cleared check. They mirror
`orgMembership.ts`'s own two functions and its prohibition on reusing one
for the other, and they set the vocabulary precedent: when a business
predicate has variants with different security meanings, each variant gets
its own scope, never one scope whose meaning depends on the route.
(Draft-program visibility remains to be decided as a graduation candidate.)
So the `rows:` declaration is a ceiling asserted by the walker, route code
may only narrow it, and CODEOWNERS stays out of product iteration while
every leak-critical rule is walker-enforced.

The ceiling has one deliberate tightening. The graduation criterion is
applied by the route author, at authoring time, with no gate;
misclassifying a security rule as business logic is the one decision that
routes around the entire review apparatus, and both cited leaks were, at
the time, someone believing their case was ordinary product logic. So
**routes returning top-tier fields (`personal`, `internal` on minors'
models) assert their row set exactly, in both directions.** If such a route
narrows further than its declaration, either the declaration was too wide
or the narrowing is undeclared policy; either way a human looks. Exactness
is an obligation scaled to sensitivity, not the universal rule the ceiling
model correctly rejects.

### View selection: first-match, with the gap made checkable

`orderedView` is walked top-to-bottom and the first role the caller holds
decides the whole view. The alternative is union semantics: a caller sees
everything any of their roles grants. The two fail in opposite directions,
and the failure direction decides it:

- **First-match under-grants.** A caller who is both keyholder and program
  lead gets whichever entry matches first; the second capacity's visibility
  is silently lost unless the registry author hand-built a combined band,
  which is exactly what `trusted-adults/operational` does (its keyholder
  entry carries the program-lead tokens). The failure is *missing data*: a
  product bug, fail closed. But the burden is manual and combinatorial;
  every route author must anticipate role overlaps, and ordering itself is
  policy, so a reorder is a visibility change.
- **Union over-grants.** Entries get simpler (each states only its own
  role's grants, order stops mattering) and multi-role callers lose
  nothing. But the reviewable unit stops being the line and becomes the
  *powerset*: what a board-member-who-leads-a-program sees is the merge of
  two lines that no one wrote or reviewed as a whole, and the failure is
  *extra data*, fail open. Switching an existing first-match registry to
  union would also silently widen every route where a caller can match two
  entries, making the migration a re-audit of the whole registry. For
  governance, per-role statements ("a keyholder sees…") would stop being
  the whole truth.

A security boundary should fail closed, so **first-match stays**. Its real
cost, the silent under-grant on role overlap, is mechanically detectable,
so it stops being a judgment call: a registry validator flags any route
where a caller matching entry *i* could also match a later entry *j* whose
tokens are not a subset of entry *i*'s.

Resolving a flagged overlap needs more care than "merge the bands," because
the two token classes behave oppositely when merged into a base entry.
**Scope-qualified tokens are inert-safe to merge**: the
`trusted-adults/operational` keyholder entry carries
`their_program_households:personal`, and a keyholder who leads no program
has an empty program-household set, so the token resolves to nothing on
every row, by construction. **Unconditional tokens are not** (`everyones:*`,
`keyholders:*`, flat `member`): merged into a base entry they grant to
every holder of the base role, silently defeating first-match's fail-closed
property, and the merge is exactly what a support ticket produces, because
the ticket says a real person cannot see something they need. So the
resolutions are: merge when the tokens are scope-qualified; for
unconditional tokens, author a **conjunction entry** (`orderedView` entries
may match a conjunction of roles: `keyholder AND programLeadMentor`, placed
above both single-role entries) or annotate the entry as deliberately
capacity-scoped. The validator distinguishes the token classes so authors
are not trained to ignore false alarms, and the walker's persona world
includes a persona holding *only* the base role, asserting the merged or
conjunction grants are absent for it; without that assertion a merge is a
visibility change no test distinguishes from a correct one.

One more consequence of merging is easy to miss and must not be silent:
adding a second scope's tokens to a single-scope view **changes the
route's tripwire class** from fail-closed (empty expected-removal set) to
alarm-only (nonempty), because the class is derived from the declaration.
A merge that looks like a pure visibility fix is also an
enforcement-mode downgrade. The validator therefore reports the class
transition alongside the overlap resolution, and the governance report's
per-route appendix marks which class each route is in, so the downgrade
is a reviewed fact rather than a side effect.

### Relationship edges are policy writes

A consequence of choosing a relationship-based model, and one no registry
review can see: **the relationship rows are the access-control database.**
Access resolves against the FK graph (`their_households`,
`their_program_participants`, `led_households`), and those edges are created
through ordinary product screens by front-desk staff and household leads
doing ordinary work. Adding a person to a household, marking a household
lead, enrolling a child, assigning a program lead: each is data entry that
also grants someone visibility into a family's records, a child's records,
performed by someone with no idea they are writing policy, reviewed by no
one, invisible to the board's report. The declaration "program leads see
their program participants" stays true no matter who is made a program
lead. The domain makes this the normal case, not the edge: custody
arrangements, foster placements, and separated parents are precisely where
"household member" and "person entitled to see this child's address" come
apart. A low-privilege attacker's cheapest path into another family's data
is not an IDOR; it is getting an edge created by asking a busy person for
help.

The design cannot prevent this and should not try; what it does is make the
grant visible. Three mechanical rules, all cheap because the information
already exists:

- **The set of access-granting edges is derived, not curated**: it is
  exactly the bound keys of `SCOPE_BINDINGS`. Adding a binding adds its
  edge to the governed set automatically.
- **Every write to an access-granting edge is audited** (actor, subject,
  time) **and reversible**. One rule, at the same injection point the
  facade already owns.
- **The governance report renders the edge set as its own section**: these
  actions grant visibility, and these roles may perform them. The board's
  question is who can see a child's home address; the honest answer
  includes who can *arrange* to see it.

Second-party confirmation on the highest-stakes edges (household
membership, household lead) is an open consideration below; the audit trail
and the report section are not optional.

### Writes (I4): same vocabulary, separate design

Write-path row authorization reuses this design's primitives rather than
adding to them. "May act on" is the same relationship vocabulary
(`their_own` and `led_households` already gate the attendance writes); the
ownership check is the same `rowsWhere` fragment composed into the write's
`where`, where an update matching zero rows yields a 404, exactly the shape
the attendance routes hand-write today; and ceiling semantics, the
not-found convention, and the registry declaration all transfer unchanged.
What writes add is new but bounded: **input authorization** (which fields
may this caller *set*: a writable-fields analogue to `@sensitivity`),
**create scoping** (no stored row yet, so the scope predicate evaluates
against the incoming body's foreign keys: "may create a Visit for a person
in a household you lead"), and a mutation harness for the walker. That is a
coherent design of its own, taken up in a separate document.

It imposes exactly one constraint on the read side, adopted here so the
declaration format never needs a breaking change: **`rows:` declarations
are verb-aware from day one.** On a read verb the declared scopes mean "may
see"; on a mutating verb they mean "may act on." The grammar carries the
distinction even while the write design is deferred.

### Invisible rows are not found

When a caller requests a specific row they may not see, there are two
possible answers, and they leak different things. **403 Forbidden confirms
the row exists**: probe sequential ids and the status code enumerates the
database, which in this domain means enumerating children, households, and
who was in the building. **404 Not Found reveals nothing**, at the cost of
honesty: a legitimately under-permissioned user is told "no such thing"
rather than "ask for access," which is worse UX and a small support tax.

For data about minors, existence is itself the sensitive fact (the whole
edge-model class), so the rule is:

- **Identity-bearing requests fail as 404.** Any route addressing a row by
  id (`/api/visits/123`, an id in a body) answers exactly as if the id did
  not exist when the caller holds no scope on it: same status, same body as
  a genuinely absent id. This is already the practice on the attendance
  routes ("404s any id the caller may not act for"); it becomes the
  convention, not a per-route choice.
- **Capability refusals fail as 403/401.** When no specific row is in play,
  a non-board caller hitting a board dashboard for instance, forbidden is
  honest and leaks nothing, because the *route's* existence is not a
  secret.

The query-side design makes the safe answer the cheap one: the injected row
filter means an invisible row and a nonexistent row take the same code path
(the query returns nothing), so the identical-404 property holds by
construction instead of by discipline. The walker asserts it: for every
persona, a real-but-invisible id and a fabricated id must produce
byte-identical responses.

One shipped route deviates on record. The pentest findings deliberately
split `programs/[id]`: unauthenticated callers get 404, while
authenticated non-members get 403 ("join to see this"). That is a
**recorded exception**, declared on the registry entry and rendered in
the governance report, and the walker asserts the declared behavior
rather than the blanket convention. It is also expected to become moot:
the product direction is for non-members to see member-only programs
without being able to act on them, at which point the exception is
deleted rather than carried.

### Aggregates can disclose by shape

I3 makes counts honest by default: computed over the filtered set, a
count tells the caller how many rows they may see. It carries one
declared exception, already decided three times in this repo's history
(the pentest findings, the rejected re-litigation recorded in
`auth-consistency-analysis.md`, and the `routeAuthDrift` pin): **a route
may declare a count public over rows the caller cannot see**: the
"rows private, count public" shape that lets an anonymous catalog show
`_count.participants` capacity without exposing the roster (#575's fix
kept exactly this). Under bare I3 an anonymous caller's filtered set is
empty and every public program would render zero capacity, re-breaking
that fix; the exception is therefore a first-class declaration
(`counts: public` on the route's model entry), rendered in the
governance report, not a route-code workaround.

The second aggregate control is **cell size**, and it is independent of
row visibility. A dashboard grouping households by scholarship status or
background-check state can report a cell of one, and a cell of one in a
program of twelve identifies a family to anyone who knows the roster,
with the caller fully authorized for every row; the disclosure is in the
shape of the summary. So the trigger keys on shape, not visibility:
**any grouped aggregate declares either a minimum cell size or an
explicit grant permitting exact small counts**, one field on the
declaration, checked at registration. The surface is small today (two
dashboard routes, nine `_count` files), which is the argument for
deciding now; aggregate disclosure control is never retrofitted, because
by the time anyone wants it there are forty dashboards.

### Derived values: declassification as a declared projection

Today a computed value (an age band, an "is adult" flag, a masked email)
has no place in the model: the stripper drops anything that is not a
classified model field, so routes ship the raw classified *inputs* and the
client derives. `turning-18` ships every dateOfBirth so the browser can
compute an age. That inverts data minimization: the derived value is almost
always *less* sensitive than its inputs, yet the inputs are what cross the
wire.

The fix is to make projections first-class and give them the
information-flow treatment:

- A **projection catalog** (CODEOWNERS-gated, one shared file) declares
  each derived field on its model: its name, the input fields it needs, and
  its tier. Mechanically this is a Prisma client result extension,
  `isAdult: { needs: { dateOfBirth }, compute }`, so the `needs` clause
  *is* the declared data flow, and the generator folds projections into
  `classifications.ts` like any other field.
- **A projection's tier defaults to the highest tier of its inputs.**
  Declaring a *lower* tier is a **declassification**, the one place in the
  system where sensitivity is deliberately reduced, and gets the
  security-boundary PR treatment. `isAdult: public` derived from
  `dateOfBirth: personal` is exactly such a reviewed decision.
- The facade selects **only the projection field, never its inputs**:
  Prisma's result-extension machinery fetches `needs` fields internally
  and omits them from the returned object unless they were explicitly
  selected (verified on Prisma 7). The raw input never enters the result
  object, so there is nothing for an error serializer or log line to
  observe and nothing for the stripper to remove. The DOB never leaves
  the database round-trip; the age band does. (Auto-including the inputs
  in the select would reintroduce exactly the pre-stripper exposure the
  per-view select exists to end.)

This is easier than today for the route author, who references a declared
projection instead of shipping inputs plus client math, and better for
review: every tier downgrade in the system is enumerable in one file.

**The review unit is the input field, not the projection.** Each
declassification alone looks obviously fine: `isAdult` from a birth date,
then an age band, then a turning-18 flag, each reasonable, each approved;
jointly they can let a public-tier caller narrow a child's birth date to a
month. No per-projection review can see that, because no one ever sees the
set. The catalog already carries the `needs` clauses, so the generator
renders, **per high-tier input, every declassified projection derived from
it and every view that grants them**; adding a projection over an input
that already has one is a review of that whole set, not of the addition.
The same per-input rendering goes to the governance report; "birth dates
are not visible, though adult status and age band are" is exactly the
sentence the board should be approving.

### The tier split: deliberation is not process metadata

The scope-variant rule has a tier-axis twin, found by the domain-register
audit (#1528, row A15) against `GET /api/trusted-adults/mine`.
`TrustedAdultReview.decisionNote` (the board's private reasoning about a
family) and `TrustedAdult.familyContext` (the narrative the family wrote
and must read back) are both `@sensitivity:internal`, on rows the same
caller holds the same scope on, in the same response bag. The route's
`their_households:internal` grant admits both; what keeps the board's
reasoning out of the family's response is the hand-written select, pinned
by one integration test. The contract test cannot catch a regression,
because `internal` *is* granted: adding `decisionNote: true` passes CI.

Unamended, this design would inherit that gap and flip its default. The
per-view select is generated by intersecting the view's tokens with the
model's classifications, so the generated select for `/mine` would
include `decisionNote`, and a route that omits its hand narrowing ships
the field. The tripwire is silent (a single-scope view, and the field is
granted); the projection catalog only lowers tiers; exactness assertions
govern rows, not fields. By this design's own graduation criterion,
hiding `decisionNote` is policy, and the only field-level policy
vocabulary is the tier. So the tier must say it.

**Decided: the tier vocabulary splits.** `internal` keeps its documented
meaning, role/process/audit metadata. A new tier, **`deliberative`**,
carries reviewer and board private reasoning:
`TrustedAdultReview.decision` / `decidedById` / `decisionNote`, and
`BackgroundCheckAttestation.result` / `note`. The name is chosen to read
as English in the governance report ("the board's deliberative notes are
visible only to the board"). The blast radius is measured and small:
`their_households:internal` is granted by exactly one registry view, and
the re-tier needs `everyones:deliberative` added to the board/sysadmin
lines of three routes; one boundary-isolation PR (token grammar, five
schema annotations, six tokens), no migration. It must land **before
sequencing step 5 reaches these routes**, because that is the moment the
hand-written select stops being the protection. The pinning integration
test stays; after the split it is no longer the only control, which is
the point.

This makes the variant rule symmetric across both axes of the
vocabulary: **when a scope or a tier means two things with different
security consequences depending on the route, split it**; never let one
name's meaning depend on where it is used. `internal` meant both
"process metadata" and "reviewer deliberation," and those diverge exactly
where a family reads its own review, so they are two tiers. The class
has one more prose-guarded member, `Household.intakeNotes`
(family-authored narrative held at `pii` so reviewers can read it,
guarded today by a schema comment); it is the next re-tier candidate
under the same rule.

One neighboring case needs a third mechanism, because neither tiers nor
projections can express it. `GET /api/membership/reviews` hides reviewer
A's identity from reviewer B, but `reviewerId` is `public`-tier and
needed as a foreign key elsewhere, so the generated select would ship it
and a projection can only add or declassify, never withhold. The
mechanism is a **declared field withhold**: a registry entry may name
fields excluded from its generated select (`withhold: {
BackgroundCheckAttestation: ['reviewerId'] }`), which is narrowing as
policy rather than as route code: CODEOWNERS-reviewed, walker-asserted
(the field absent for every persona), and rendered in the governance
report ("reviewers cannot see who else has signed off"). Withholds share
the tier split's deadline: they must be declared before the generated
select reaches their routes, because today's protection is the same
hand-written select in both cases.

### Surfaces without a session caller

The registry models one situation well: a session-holding human calling a
route. Five surfaces fall outside it. They are not deferred as a unit,
because most are cheap to declare and one is the largest uncontrolled
disclosure channel in the system:

- **Outbound** is where the work is, and its control state must be
  stated honestly: `defineOutbound` surfaces exist in the registry, but
  the enforcement wrapper (`outboundCall`) has **zero production call
  sites**; real mail goes through `sendEmail` directly, so both the
  tier list and everything else are unenforced today. The work is
  therefore adoption first, and then one concept the registry lacks: a
  **recipient**. Tiers alone cannot make an email safe; the question is
  not only which fields the message carries but whether *this recipient*
  may receive facts about *these people*. The existing vocabulary
  answers it without extension: **a message is well-formed when the
  recipient holds a declared scope over every row the message
  describes.** That one rule catches the wrong-join class, the realistic
  outbound failure, and makes outbound renderable into the governance
  report. Adoption has its own sequencing step, so this channel has an
  owner rather than an adjective.
- **Cron** (`withCron`) has no caller and is system-context by nature:
  declared as such, jobs enumerated, printed in the report alongside the
  `asSystem()` inventory.
- **Webhooks** (`withWebhook`) carry a verified machine identity: a
  principal with a fixed declared scope set. A small declaration.
- **Kiosk** (`withKiosk`) is not the fixed public band it first appears:
  the presence-identity tiering design has the kiosk view holding
  `all_current_visitors:personal`, a row-scoped grant (who is in the
  building, with the fields the front desk needs). The kiosk therefore
  enters the registry as a principal with a declared row-scoped view,
  same grammar as everything else.
- **`GET /api/attendance`** fits no wrapper at all today: it hand-rolls
  `verifyKioskSignature` plus an optional session, serving both the
  kiosk presence board and signed-in views from one route. It is named
  here so the taxonomy has no silent fifth door: it migrates as part of
  the kiosk-principal declaration, and the presence-tiering design marks
  it as the route that breaks if migrated naively, so it converts
  deliberately, not in the bulk wave.

### The governance view: policy renders to English

Because the policy is data (registry + bindings + classifications), a
plain-language report is a **generated artifact**, not a writing task. The
scope names were already designed to read as English possessives
(`their_program_households:personal` → "their program households' personal
data"; see the "reads as" table in SECURITY-POLICY.md, which needs its two
later-added scopes, `their_program_households` and `keyholders`, filled
in as part of the generator work).

**The primary rendering pivots by data subject and tier, not by route.**
Route-by-route is the engineer's axis; across the full surface it produces
hundreds of sentences a volunteer board will approve without reading, and
approving without reading is worse than not approving, because it creates a
record of oversight that did not happen. The board's actual questions are
about data subjects: who can see children's home addresses, who can read
safeguarding narratives, who can see who is in the building right now.
Pivoting the same declarations by field tier and subject yields perhaps
thirty sentences of the form:

> **Children's home addresses** are visible to: the child's own household,
> and board members. Program leads see their program households' emergency
> contacts, but not addresses or intake notes.

The route-shaped rendering remains as a maintainer appendix. Three further
properties keep the report honest rather than ceremonial:

- **Every sentence carries attestation**: whether a walker persona asserts
  it. Report generation **fails** if an unasserted sentence would print
  without an explicit exemption; a sentence no test has exercised must not
  look identical to one proved twenty ways.
- **Ungoverned doors print as ungoverned rather than being omitted**: the
  `asSystem()` inventory, the cron jobs, every front door outside the
  policy (enumerated from the wrapper inventory), and the tripwire disable
  switch's state. A report silent about the mail that leaves the building
  implies a completeness it does not have.
- **Every PR that changes a declaration carries the report diff**, so board
  review is a ratchet, not a single event.

This artifact is only possible because no route hand-writes its own
visibility; hand-rolled `where`/`select` code can never produce it. The
generator is cheap, a walk over the same data the validators already walk,
and ships alongside the walker, because the same declarations feed both.

This also sets a selection criterion used above: any adopted engine must
keep policy in a form that renders to this report. ZenStack's ZModel
qualifies (declarative, per-model rules); raw query-builder or route-code
enforcement does not, regardless of engine quality.

### The walker's world is derived-complete

The walker proves row policy by signing in as seeded personas and checking
which rows each receives, which proves something only if the data contains,
for every relationship, both a row the persona *should* see and one they
*shouldn't*. A test that passes because the data is missing is the worst
artifact in a security system: indistinguishable from a test that passes
because the code is correct, and no human ever suspects it. Today's
`seedBaseline` has zero volunteer designations, so any volunteer-visibility
assertion against it passes vacuously.

Ownership by convention will not hold, so completeness is **derived and
mandatory**, and derived from the right set. Enumerating scope×model
pairs from `SCOPE_BINDINGS` alone would exempt exactly the models parked
in `OPT_OUT_PENDING_ROUTE` (including `VolunteerDesignation`, the
motivating vacuous case), so the enumeration runs over **every sensitive,
scopable model in the classifications**, bindings present or pending:
bound pairs need their discriminating rows now; pending models need them
the day their binding lands, enforced by the same check. Adding a scope
creates the obligation automatically instead of depending on memory. The
world **extends `seedBaseline`** rather than standing alone: data
developers use daily has its gaps noticed, while an independent fixture
set rots unwatched. Gating has one mechanical prerequisite: the seed
helpers file joins the boundary workflow's companion list, because
otherwise a scope PR carrying its discriminating rows fails boundary
isolation while splitting the PRs leaves the mandatory check red in
between; the check must be satisfiable by a compliant PR shape.

### Where scope predicates get their answers

Scope predicates are answered **per request, from `CallerContext` prefetches
gated by `ctxNeeds`**, never from session claims.

- **Role flags are fresh per request today; that is a real, verified
  property that nothing declares.** Verified against next-auth 4.24.14 and
  the app's auth code: under `session.strategy = "jwt"`, `updateAge` is
  inert (next-auth consults it only in the database-session branch,
  `core/routes/session.js:109`, while the JWT branch at `:53` runs
  `callbacks.jwt` on every session read). The callback's returning-caller
  branch re-queries `prisma.person` and re-stamps every claim
  (`auth-options.ts:367-401`), and every API route reaches the session
  through `authenticateRequest` → `getServerSession` (`lib/auth.ts:46`),
  with the drift guard banning any other path. So a revoked role flag is
  gone on the caller's *next request*; there is no fifteen-minute window on
  the API surface. Staleness survives only in middleware page gates
  (`getToken` decodes the cookie without the callback, up to the 8h
  `maxAge`), which gate navigation, not field bands; that remainder is
  documented as accepted. **The risk is therefore inverted.** This
  freshness is a security invariant produced by a four-relation person
  lookup on every request, undeclared and untested; it is the first thing
  profiling finds, and a fifteen-minute cache is the obvious "fix" that
  would silently create the revocation window this domain cannot accept (a
  program lead removed after a safeguarding concern keeping other
  children's emergency contacts). So per-request role freshness is
  **declared here as an invariant**, commented at the callback, and pinned
  by a test asserting a revoked flag is absent on the next request. When
  view selection moves into the registry, view-selecting roles resolve
  through `CallerContext` under `ctxNeeds`, paying the cost only where a
  view consults the role, rather than widening the callback further.
  (`programLeadMentor` and `programCoreVolunteer` already work this way,
  from `ctx.programsLed`.)
- **Row-policy predicates are computed fresh in `CallerContext`**, because
  a stale row predicate is a fail-open leak window, not a latency
  inconvenience. Honesty about the alternative: for `org_members`
  specifically, a session claim would be neither costly nor stale: the
  jwt callback already loads `household: { include: { orgMembership:
  true } }` on every request (`auth-options.ts:343`), so an
  `isActiveOrgMember` claim would cost zero extra queries and be exactly
  as fresh as the role flags above. The rejection stands on the two legs
  that survive that concession. First, **predicate collapse**: program
  visibility needs the wider dues-settled check (#1397), whose data the
  callback does not load, and a single membership boolean on the session
  is precisely the conflation `orgMembership.ts` forbids; two claims
  with different data needs is the session growing into a second,
  partial `CallerContext`. Second, **uniformity**: every scope predicate
  resolving through one `ctxNeeds`-gated path keeps the invariant
  auditable ("row policy is answered here, always") and keeps the
  callback from accreting per-scope loads. The general rule below is a
  design rule, not a cost claim.

The general rule: **a fact that decides row visibility must be readable at
request time from the database of record; the session may cache capability,
never row policy.**

### Build vs adopt

The policy *data* (tiers, scopes, registry, bindings) is domain-specific
and stays bespoke under any option. The question is only the engine.
Adopting ZenStack mid-flight means migrating policy into its schema DSL on
live data and coupling to its release trajectory; building means owning a
small compiler, but the surface is bounded (7 scopes, ~20 models, two
generated artifacts: `where` fragments and `select` unions) and the
equivalence-test discipline to verify it already exists in-repo.

What "adopting ZenStack" means for Prisma differs by major version, and the
difference is the trajectory risk in concrete form. **v2 layers on Prisma**:
the ZModel schema is a superset that *generates* `schema.prisma`,
migrations stay `prisma migrate`, and enforcement is `enhance(prisma)`
wrapping the existing client per request, with the raw client remaining
available as the system-context escape. Prisma is not replaced, but
`schema.prisma` becomes a generated artifact, so the `@sensitivity` →
`classifications.ts` pipeline and every schema-comment convention must
survive a move to ZModel. **v3 replaces the runtime**: it reimplements the
Prisma-compatible query API on its own engine (Kysely-based) rather than
wrapping `@prisma/client`. Adopting v2 means betting on a wrapper whose
successor is not a wrapper; adopting v3 means the ORM itself is no longer
Prisma. Either way "adopt" is not a bolt-on; it takes ownership of the
schema toolchain, which is why the build recommendation stands for checkin
despite ZenStack's more mature relation-traversal machinery.

#### Alternatives to ZenStack

ZenStack is the only tool offering the full package on Prisma (schema-level
policy DSL, row injection, field-level read masking, nested-relation
enforcement), but three neighbors cover parts of it, and one changes the
build option's shape:

- **CASL + `@casl/prisma`**: an ability library whose Prisma adapter
  converts declared conditions into `WhereInput` fragments
  (`accessibleBy(ability).Model`). This is not an alternative *policy
  model*; it is a battle-tested implementation of exactly our `rowsWhere`
  component. It creates a middle path: **build the policy layer (registry,
  scopes, bindings, unchanged), borrow the fragment engine** instead of
  hand-rolling the conditions-to-`where` conversion. Field-level and
  nested-read enforcement remain ours (stripper + generated selects),
  which we keep anyway. The cost is mapping the scope vocabulary onto
  CASL's ability model and taking a dependency for roughly the 100 lines
  the issue estimated. Worth a day's throwaway prototype (map two or three
  scopes, see whether the vocabulary fits, keep the answer and discard the
  code) before deciding; not obviously worth the indirection.
- **Cerbos**: externalizes the policy *decision* (YAML policies, a policy
  decision point), and its Prisma adapter converts decision query plans
  into `where` filters, so enforcement stays query-side. The right shape
  for an organization standardizing policy across many services; for this
  portfolio it reintroduces a standing service (or an embedded PDP) and a
  second policy language for a vocabulary seven scopes wide. Same verdict
  as Zanzibar: right abstraction, wrong weight.
- **Yates**: manages Postgres RLS *from* TypeScript. Abilities are
  declared in code, compiled into RLS policies, with per-request
  role/context set through a Prisma client extension. Not relevant to
  checkin's rich scopes, but directly relevant to the **portfolio
  RLS-primary path**: it is the plumbing (policy generation plus a
  GUC-setting extension) that path needs, pre-built. If the portfolio
  decision (open issue 1) lands on RLS, evaluate Yates before hand-rolling
  the extension.

GraphQL-tier permission systems (Hasura, PostGraphile) solve the same
row-and-column problem declaratively but require adopting a different API
layer entirely; not applicable to these REST routes.

#### Why the query-builder distinction matters to a policy compiler

ZenStack's v3 move from Prisma-wrapping to a Kysely engine is not a
packaging detail; it responds to the exact problem our facade must solve,
and seeing the same query in both APIs shows the trade. Prisma is an
object-graph API: relations resolve by name, nesting is free, and a filter
is a nested object tree.

```ts
// Prisma: facade-injected row filter merged with the route's narrowing
const rows = await prisma.programParticipant.findMany({
    where: {
        programId: { in: [...ctx.programsLed] },   // policy fragment
        status: 'ACTIVE',                          // route narrowing
    },
    select: { id: true, status: true, person: { select: { id: true, name: true } } },
});
// → [{ id, status, person: { id, name } }]
```

Kysely is a typed SQL builder: joins are explicit, results are flat unless
JSON helpers rebuild the nesting, and types come from a generated DB
interface (`prisma-kysely`; the schema stays the source of truth):

```ts
// Kysely: same read; the join and the nesting are the author's job
const rows = await db
    .selectFrom('ProgramParticipant as pp')
    .select(eb => [
        'pp.id', 'pp.status',
        jsonObjectFrom(
            eb.selectFrom('Person as p')
                .select(['p.id', 'p.name'])
                .whereRef('p.id', '=', 'pp.personId'),
        ).as('person'),
    ])
    .where('pp.programId', 'in', [...ctx.programsLed])   // policy fragment
    .where('pp.status', '=', 'ACTIVE')                   // route narrowing
    .execute();
```

The security-relevant difference is **how a filter composes**. In Kysely,
injecting policy is appending `.where()` calls: every clause ANDs, so
composition is *monotonic narrowing by construction*; a route cannot
accidentally weaken an injected filter, only add to it. In Prisma,
injecting policy means **merging object trees**, and the fail-open case
is key collision: a route key shadowing a fragment key on spread
replaces the policy condition outright. (Sibling keys beside a route
`OR:` block still AND in Prisma's semantics; collision, not
coexistence, is the widening mechanism.) A query builder has no merge
step to get wrong, which is consistent with ZenStack's v3 move to one;
either way the design rule our bespoke facade adopts is:

> **The facade composes filters as `where: { AND: [policyFragment,
> routeWhere] }`: always wrapped, never spread.** The equivalence tests
> for the facade must include the collision cases: route `OR:` blocks,
> route keys shadowing fragment keys, and empty-object fragments.

Prisma's ergonomics (free nesting, named relations, generated types) remain
the reason the facade wraps Prisma rather than moving to a query builder.
The cost of that choice is exactly one rule, wrap-never-spread, and it is
cheap to enforce and test.

The nested-include leak class is the decisive test case for this choice.
The row leaks that actually shipped did not enter through the top-level
model; they rode in on relation traversal: #575 (`programs/[id]` including
full participant/volunteer rosters) and the whole `EDGE_INCLUDE_ALLOWLIST`
class. (#957, the raw-row echoes on household write routes, is the
neighboring top-level class: whole rows echoed from writes, caught by the
same generated-select rule rather than by relation recursion.) The lesson
is
mechanism-independent: enforcement must be **per model, applied recursively
at every node of the query graph**, because a route author reasons about
the top model and the leak enters through the include. Both build and adopt
close that hole the same way, so the hole itself argues for *construction*,
not for either engine. But it is not neutral on engine choice: relation
recursion is where the build cost concentrates. Injecting `where` into
to-many includes is simple composition; to-one relations take no `where` in
Prisma and need null-out handling; filtered `_count`, required relations,
and arbitrary include depth are exactly the machinery ZenStack has already
built and debugged. A hand-rolled compiler that supports arbitrary include
graphs *is* the "general policy engine" the reversal criterion warns about.

Whether a constrained grammar can hold is an empirical question about the
routes that exist, so the full route surface was surveyed (all 142
`route.ts` files, current worktree):

- **Include shapes are shallow and uniform.** 39 files use `include:`; the
  heaviest files have three include sites; observed depth tops out around
  three levels (e.g. `membership-ops/households`: Household →
  householdMembers → programParticipants → program). The recurring shape
  is one pattern, *to-many include + row filter + field select*, sometimes
  nested once more. No route needs arbitrary graph support.
- **69 files use flat `select:`**, trivially covered by generated selects.
- **Raw SQL (8 files) is concurrency control, not read shape**: advisory
  locks (`pg_advisory_xact_lock`) inside write transactions on the
  attendance/scan/visit paths, guarding the one-open-visit invariant. No
  read path ships raw-SQL rows, so the facade's read guarantees are
  unaffected; these transactions go through the write/`asSystem` escape
  regardless of engine.
- **Aggregates are marginal**: two ops-dashboard routes use
  `groupBy`/`aggregate`; nine files use `_count`.
- The survey also found `where: LIVE_PERSON` hand-sprinkled inside nested
  includes: the I5 exclusion being remembered per include site today,
  which is precisely what shared injection removes.

**Recommendation: build, with a constrained include grammar.** The survey
is why: the grammar the facade must support (to-many with injected filter
and select, to-one to a declared model, filtered counts, depth ≤ 3) is not
a hopeful subset, it is the observed entirety of current usage. Reject
anything else at registration. The reversal criterion, made concrete: if
route needs pressure the facade into general include-graph support, adopt
ZenStack rather than grow the compiler.

One shape inside the grammar is forbidden as an enforcement mechanism:
**null-out on to-one relations to scoped models.** Null-out fetches the
related row and discards it in application code, which is response-side
enforcement under the facade's name, at exactly the traversal type the
shipped leaks came through. Two constructions replace it, both within the
grammar: where the FK is on the parent, test it against the scope predicate
*before* issuing the include, so an unauthorized relation is never
requested; otherwise express the relation as a filtered to-many and take
the first row, which composes a real `where`. The registration validator
rejects to-one shapes to scoped models that cannot use either construction.

### Portfolio scope: what generalizes and what doesn't

The intent is to apply this security model across the wider portfolio
(`/Volumes/Untitled/Inventory`: auth, receipt, expense, income,
bulkdonation, local-inventory, global-catalog, workflow-mapping; 8
Next.js + Prisma apps, ~195 routes, ~76 models, surveyed the same way). The
survey says the portfolio is a different problem on the same stack:

- **The dominant row axis is `orgId` multi-tenancy**, not relationship
  scopes: 131 of 195 route files touch `orgId`, enforced per-route through
  shared helpers (`requireRole` ×110, `requireUser` ×66, `requireOrgBearer`
  for M2M). One tenant-equality predicate, hand-written everywhere: the
  same forgettable-convention disease, but with a far simpler cure.
- **Sensitivity is real but differently shaped.** The inventory apps hold
  financial records and customer PII (receipt customer emails and names,
  three plaintext copies per the F9 analysis in `Inventory/ENCRYPTION.md`,
  plus donations, expenses, income). The *tier vocabulary* therefore
  applies there too; what is absent is checkin's per-relationship
  visibility problem, because inventory's sensitive fields are role-banded
  within a tenant, not scoped by household or program relationships. (F9's
  retention/erasure question is a separate axis on top, not replaced by
  any of this.)
- **Query shapes are trivial**: 4 files with `include:` across all eight
  apps, zero raw SQL in routes.

Consequence: **checkin's engine should not be the portfolio engine.** A
7-scope relationship compiler is over-fitted to an ecosystem whose row
policy is one equality. But the split between what standardizes and what
varies must be drawn precisely, because the governance requirement is
portfolio-wide: the same board is accountable for the financial data in
inventory as for the safeguarding data in checkin, and raw RLS policies in
SQL migrations are exactly as governance-unreadable as Kysely chains.

The resolution is the same move the design already made once: **the
consistent portfolio-wide layer is the policy representation; enforcement
engines are per-app compile targets of it.**

- **Standardized everywhere** (the portfolio spine): the declaration format
  (tiers on fields, roles, row predicates per route/model), the invariants
  (I1–I5 restated per app), the governance report generator producing one
  board-readable document format covering every app, the persona walker
  pattern, equivalence-test discipline, fail-closed defaults, and the
  CODEOWNERS/boundary-isolation review process. This is where consistency
  buys simplicity, and it is cheap: data formats and test patterns, not
  runtime code.
- **Per-app compile target**: checkin compiles declarations into facade
  `where`/`select` fragments, because its relationships demand an
  app-layer engine; an inventory app compiles the *same declaration
  format* into generated RLS policies (Yates-shaped) or a thin tenant
  middleware. **RLS is never hand-written policy SQL**; it is emitted from
  the declarations, so the governance report, the walker, and the
  declaration-to-enforcement equivalence test work identically in both
  worlds. That answers the governance question for the RLS path: the board
  reads the same generated report either way, because the source of truth
  is the declaration, not the mechanism.

Standardizing the *engine* itself, one mechanism everywhere for
simplicity's sake, is the tempting wrong version of consistency: forcing
the relationship compiler onto tenancy apps is over-engineering carried to
eight codebases, and forcing RLS-on-orgId onto checkin cannot express its
domain. Two engines compiled from one representation is less total
complexity than one engine misfitted to half its users.

**Repo topology does not change this, and mostly strengthens it.** If the
monorepos split into many repos, the spine travels as a small shared
package (declaration schema, report generator, validators; deliberately
free of runtime enforcement, so versioning it across repos is low-risk),
and app-local engines don't care where their repo is.

Shared databases deserve a more honest statement, because **the portfolio
is already multi-app-on-shared-data**: checkin-app reads the s-read
function's `shopify_read_<env>` mirror on the *same Aurora cluster* as its
own database; s-read and s-replay share one dedicated DB through a common
schema-owning package; the monitoring DB takes writes from several
functions. And the boundary already in production for the mirror is
**database-resident enforcement**: a SELECT-only Postgres role granted in
infra (`modules/s-read/init.sql`), "by GRANT, not by convention." DB-level
enforcement is not a foreign idea here; it is the trusted precedent for
every cross-app boundary the portfolio has.

What distinguishes today's arrangement from the scenario that forces RLS
is granularity. Role grants handle **app-to-app** boundaries (this app may
read those tables, read-only), and that is all today's shared surfaces
need. RLS becomes necessary when a shared database must enforce
**per-caller row** policy: the situation that arrives if checkin splits
into several services over its own DB, where app-layer enforcement would
multiply into N drifting copies. That split is a standing trigger to
re-run the RLS decision (open issue 1); the generated-from-declarations
rule is already in place, so the move would not cost the governance
surface, and the grant-based precedent makes it an extension of existing
practice, not a new philosophy.

### Coverage

The design applies to the entire session-authenticated read/write surface:
**every `withAuth` route is in scope, and each migrates once, directly to
the facade form**, with no interim bare-`handler()` generation. Two
qualifications keep the mandate honest:

- **Computed-envelope routes wait for projections.** The standing
  DECISION RECORD in `auth-consistency-analysis.md` blocks the `withAuth`
  collapse on a `derive` hook: `handler()`'s strip path silently drops
  computed and derived response fields (`isMember`, `isPresent`, fallback
  names), so those routes "must not be force-migrated." The projection
  catalog is this design's `derive` answer, so the one-hop rule stands
  with an ordering constraint: a route returning computed envelopes
  migrates only after its fields exist in the projection catalog, never
  before.
- The **7 dual-wrapper files** migrate per-verb, and the non-session
  wrappers (`withKiosk`, `withCron`, `withWebhook`) plus the hand-rolled
  `GET /api/attendance` are outside the mandate; their treatment is
  designed in "Surfaces without a session caller" above.

Build order and migration mechanics are in
[TARGET_ARCHITECTURE_SEQUENCING.md](TARGET_ARCHITECTURE_SEQUENCING.md),
deliberately not here.

## Open issues

Decisions needed before the design is final, ordered by how much they
change what gets built.

1. **RLS: backstop here, primary mechanism in the portfolio?** For checkin
   the candidate set is small (Person, EmergencyContact, TrustedAdult
   narratives, Visit) and the question is whether T4 (app-layer
   subversion) and non-route readers are in the protection goal. The
   portfolio survey raises the stakes: for eight apps whose row policy is
   `orgId` equality, one RLS pattern applied uniformly may be the primary
   mechanism, not a backstop; in that case checkin's GUC plumbing
   (per-request context through Prisma pooling) becomes shared portfolio
   infrastructure rather than a per-app cost, so the answer should be
   decided jointly with the portfolio, not per-app. Wherever RLS lands,
   the design's constraint holds: policies are *generated from the
   declarations*, never hand-written SQL, so the governance report and
   equivalence tests survive the mechanism choice. A future split of
   checkin into multiple services over one database re-opens this issue in
   RLS's favor (see the topology discussion in Portfolio scope). The
   acceptance criterion is fixed regardless of tooling: the application's
   database role must not own the tables and must not hold `BYPASSRLS`,
   and the no-context-set state must return **zero rows, not all rows**,
   proven by a standing test that issues a query with no context and
   asserts an empty result. That test is most of the layer's value,
   because the guarded failure is someone restoring a permission during an
   incident and never removing it. Two honesty conditions attach. First,
   **system readers need an explicit design before the criterion is
   adoptable**: the candidate tables are exactly what the cron jobs and
   `asSystem` paths touch, and under no-context-equals-zero-rows those
   silently no-op; the system context must be a designed, enumerated
   role, not an afterthought. Second, the escape (an app-set GUC or
   privileged role) is settable by the very subverted app layer T4
   posits, so RLS **narrows** T4 rather than surviving it outright; the
   claim must be stated at that strength and the system-context path kept
   as small as the `asSystem` inventory.
2. **Second-party confirmation on the highest-stakes relationship edges.**
   The audit trail and governance-report section for access-granting edges
   are decided (see "Relationship edges are policy writes"); still open is
   whether creating the highest-stakes edges, household membership and
   household lead, additionally requires a second person's confirmation,
   and if so which roles may confirm. A friction-versus-safety call on
   front-desk workflows that the board, not this document, should make.
3. **Provenance fields on the family's trusted-adult view.** `/mine`'s
   hand-written select also withholds `origin`, `disclosedById`,
   `hiddenAt`, and `updatedAt`: all `internal`, all granted on paper, and
   provenance rather than deliberation, so the `deliberative` split does
   not cover them. The mechanism now exists (a declared field withhold,
   see "The tier split"); what remains is the product decision: may a
   family see who disclosed a trusted adult and how? Declare the
   withhold or record the exposure as deliberate. Due before a generated
   select would ship them (sequencing step 5 reaching this route).
