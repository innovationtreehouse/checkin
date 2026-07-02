# Person-Umbrella Investigation

**Status:** investigation only — no code, schema, or migration changed. This
report maps the blast radius of a proposed repositioning and asks the human to
gate the decisions.

**Driving decision (supersedes part of `PARTICIPANT_TERMINOLOGY_PROPOSAL.md`):**

- `participant` should mean **only a program enrollee** — the
  `ProgramParticipant` relationship ("Participants Enrolled").
- The Prisma **person model `Participant`** — the sole model for *any* human
  (admin, volunteer, keyholder, youth, household lead, enrollee) — is renamed to
  **`Person`**. This is **final, not provisional** — it is the umbrella word the
  vocabulary's own UI-word column already uses for the Person concept.
- **Anything showing a MIXED set of people must not be called "participant"** —
  in schema, API, or UI. Admins and volunteers are not "participants".
- Loose attendance buckets ("volunteer" = any adult non-keyholder, "student"/
  "youth" = any minor) are in scope.

> **This resolves an inconsistency already inside `VOCABULARY.md` — it does not
> reverse it.** The doc's thesis (line 1) is *"built on relationships, not loose
> nouns: a person is named by which relationship you are viewing them through"*,
> and its core rule is *"Never a bare `member`/`Member`/`Membership`."* Yet rule
> 2a blesses bare **`participant`** as the flat word for "the human" — a loose
> noun, the exact anti-pattern it bans for `member`. That asymmetry is the bug.
> The repositioning fixes it: `participant` becomes purely the **Program
> relationship** (rule 2b), and the human gets an explicit umbrella. Note the
> doc's own table **already** names the Person concept's UI word **"person"** —
> so `Person` is the word the vocabulary already uses, not a new coinage.
> Adopting this means `VOCABULARY.md` rule 2a (and rule 5's rationale) get
> **corrected to match the doc's own thesis**, and it lands as a new phase
> (see §f).

**Deploy assumption (unchanged):** the DB is **wiped on deploy**. Migrations only
need to land the correct final schema — no backfill, no data-preservation care.
A column or model can be renamed outright.

All line numbers verified against the tree at time of writing
(branch `claude/kind-mclaren-5dab15`).

---

## (a) Model-rename blast radius

### a.1 The person model

`model Participant` — `prisma/schema.prisma:62-127`. Every field/relation:

| Line | Field | Kind |
|---|---|---|
| 64 | `id` | PK |
| 66 | `googleId` | pii |
| 68 | `email` | pii |
| 70 | `phone` | pii |
| 72 | `name` | public |
| 74 | `emailVerified` | internal |
| 76 | `image` | public |
| 77 | `accounts Account[]` | back-rel |
| 78 | `sessions Session[]` | back-rel |
| 81 | `dateOfBirth` | pii (age source → `isYouth`) |
| 84 | `isDeclaredAdult` | internal (age-status) |
| 86 | `lastWaiverSign` | internal |
| 88 | `waiverSignedBy` | internal (Int, self-ref, **not** a relation) |
| 90 | `lastBackgroundCheck` | internal |
| 92 | `notificationSettings` | personal (JSON) |
| 95-96 | `householdId` / `household Household` | FK to Household |
| 99 | `allergies` | personal |
| 102 | `isSysadmin` | **role signal** |
| 104 | `isBoardMember` | **role signal** |
| 106 | `isKeyholder` | **role signal** |
| 108 | `isBackgroundCheckReviewer` | **role signal** |
| 110 | `toolStatuses ToolStatus[]` | back-rel (**certifier signal**) |
| 111 | `bgAttestations` | back-rel (`BgAttestations`) |
| 112 | `householdLeads HouseholdLead[]` | back-rel (**lead signal**) |
| 113 | `corporationLeads` | back-rel |
| 114 | `corporationMembers` | back-rel |
| 115 | `programVolunteers ProgramVolunteer[]` | back-rel (**real-volunteer signal**) |
| 116 | `programParticipants ProgramParticipant[]` | back-rel (**enrollee signal**) |
| 117 | `programsLed Program[]` | back-rel (`ProgramLeadMentor`) |
| 118 | `feePayments` | back-rel |
| 119 | `rsvps` | back-rel |
| 120 | `rawBadgeLogs` | back-rel |
| 121 | `visits Visit[]` | back-rel |
| 122 | `eventsConfirmedBy` | back-rel |
| 124-126 | 3× `TrustedAdult*` back-rels | back-rel |

Renaming `model Participant` → `model <Umbrella>` **mechanically forces** three
things (Prisma derives them from the model name — not optional):

1. **Prisma client accessor** `prisma.participant.*` → `prisma.<umbrella>.*`
2. **Generated types** `Prisma.Participant*` (`ParticipantWhereInput`,
   `ParticipantInclude`, `ParticipantSelect`, …) → `Prisma.Person*`
3. **Relation target type** in schema everywhere a model points at it:
   `x Participant @relation(...)` → `x <Umbrella> @relation(...)`

### a.2 Forced-rename counts (model name only)

| Surface | Non-test | Incl. tests | Notes |
|---|---|---|---|
| `prisma.participant.*` calls | **114** | **701** | top files: `seed-helpers.ts` (20), `intake.ts` (6), `auth-options.ts` (6), `import/preview/route.ts` (6), `membership-ops/participants/route.ts` (5), `api/household/route.ts` (5) |
| Generated `Prisma.Participant*` types | 4 | (few) | `membership.ts` (`ParticipantWhereInput`, `ParticipantInclude`), `participantProjection.ts` (`ParticipantSelect`), `eligible-participants/route.ts` (`ParticipantWhereInput`) |
| Schema relation-target `Participant` refs | 21 lines | — | see a.3 |
| Test files touching the above (all 3 roots) | — | **142** | `src/**/__tests__` (88 dirs), `tests/`, `__tests__/` all present |

`prisma.participant` is the dominant cost: **114 production call sites across
~50 files, ~701 incl. tests.** This is a pure find/replace (accessor name), low
semantic risk, high volume.

### a.3 Schema relation targets that flip `Participant` → `Person`

Every model that references the person model by **type** (independent of FK
column name):

| Model | Line | FK column | Relation name |
|---|---|---|---|
| ToolStatus | 147 | `participantId` | (default) |
| Household | 169 | — | `participants Participant[]` (back-rel; **mixed set**, see §c) |
| HouseholdLead | 229 | `participantId` | (default) |
| BackgroundCheckAttestation | 370 | `reviewerId` | `BgAttestations` |
| TrustedAdult | 461 | `counterpartyParticipantId` | `TrustedAdultCounterparty` |
| TrustedAdult | 481 | `disclosedById` | `TrustedAdultDiscloser` |
| TrustedAdult | 511 | `decidedById` | `TrustedAdultDecider` |
| CorporationLead | 566 | `participantId` | (default) |
| CorporationMember | 578 | `participantId` | (default) |
| Program | 590 | `leadMentorId` | `ProgramLeadMentor` |
| ProgramVolunteer | 638 | `participantId` | (default) |
| ProgramParticipant | 656 | `participantId` | (default) |
| FeePayment | 694 | `participantId` | (default) |
| Event | 717 | `attendanceConfirmedById` | `EventAttendanceConfirmer` |
| RSVP | 739 | `participantId` | (default) |
| RawBadgeLog | 754 | `participantId` | (default) |
| Visit | 775 | `participantId` | (default) |
| Account | 832 | `userId` | (default, cascade) |
| Session | 846 | `userId` | (default, cascade) |

The relation *type* renames in all 19 rows. The **relation field name** and
**FK column** are a *separate* decision — see a.4.

### a.4 The FK question — does `participantId` become `personId`?

**This is orthogonal to the model rename.** Prisma lets the model be `Person`
while the relation field stays `participant` and the column stays
`participantId`:

```prisma
model Visit {
  personId    Int                        // renamed
  person      Person @relation(fields:[personId], references:[id])
}
// —or, equally valid—
model Visit {
  participantId Int                      // kept
  participant   Person @relation(fields:[participantId], references:[id])
}
```

So `participantId` and the relation-field key `participant:` in
`include`/`select` only change **if you choose it**. Counts if you do:

| Surface | Non-test | Incl. tests |
|---|---|---|
| `participantId` identifier (code) | 387 (65 files) | **997** |
| `participantId` FK columns (schema) | **10 tables** | — |
| relation-field `participant:` in `include`/`select` | 61 (36 files) | more |

**10 schema tables** carry a literal `participantId` FK column: ToolStatus,
HouseholdLead, CorporationLead, CorporationMember, ProgramVolunteer,
**ProgramParticipant**, FeePayment, RSVP, RawBadgeLog, Visit. Plus composite
`@@id`/`@@index` on `participantId`.

**The naming tension (call-out):** `ProgramParticipant.participantId`
(`schema.prisma:647`) points at the **person model** but lives on the
**enrollee join**. Under the new rule:

- `ProgramParticipant` (the model) legitimately keeps `Participant` in its name —
  it *is* the enrollee relationship (the ONE surviving `participant` sense).
- but its `participantId` column is a **person FK**, so semantically it is
  `personId`. Consumers already read it as a person id:
  `programs/[id]/page.tsx:331` → `p.participantId === member.id`.
- So the consistent end-state is `ProgramParticipant.personId` — a *program-
  participant row whose person is `personId`*. Reads slightly odd but is
  correct. Leaving it `participantId` keeps a person-FK named "participant"
  after we just banned that. **→ OPEN QUESTION Q2.**

**Recommendation:** rename FKs to `personId` **only if** the model becomes
`Person` (consistency); it roughly doubles the diff (997 vs 701 hits) but the
DB-wipe means zero migration risk. If the team wants the smallest diff, keep
`participantId` columns and rename only the model/accessor/types.

---

## (b) Legitimate program-`participant` uses to KEEP

Under the new rule, `participant` survives **only** for the Program-enrollee
relationship. Confirmed uses that stay:

| Surface | File:line | Why it stays |
|---|---|---|
| `model ProgramParticipant` | `schema.prisma:643` | the enrollee relationship itself |
| `ProgramParticipantStatus` enum | `schema.prisma:649` | enrollee lifecycle |
| `Program.participants ProgramParticipant[]` | `schema.prisma:624` | roster of enrollees |
| "Participants Enrolled" label | `program-ops/programs/[id]/page.tsx:329` | enrollee count |
| `activeParticipants` / `pendingParticipants` | `program-ops/programs/[id]/page.tsx:265-266` | filtered enrollee lists |
| `program.participants` roster reads | `program-ops/sessions/[id]/page.tsx:246,326`; `programs/[id]/page.tsx:247,331`; `programs/[id]/register/page.tsx:64` | enrollee rosters |
| `programParticipants` back-rel | `schema.prisma:116` | person → their enrollments |
| `ProgramParticipant`/`programParticipant(s)` in code | 59 non-test hits | enrollee relationship |
| `maxParticipants` (Program) | `schema.prisma:606` | cap on **enrollees** — legit |

These are the only "participant" uses that comply. Everything in §c is misuse.

> Caveat on `Program.participants` (`schema.prisma:624`): the relation field is
> `participants` and it targets `ProgramParticipant[]` — this is genuinely
> enrollees, so it is a **keep**. Do not confuse with `Household.participants`
> (§c), which targets the person model and is a mixed set.

---

## (c) Mixed-people misuse (the problem) + recommended replacements

Each set below is populated with **every kind of human** (admins, board,
keyholders, volunteers, youth, leads) yet is labelled "participant(s)".

| # | Surface | File:line | Who's actually in the set | Should be |
|---|---|---|---|---|
| c1 | `Household.participants` relation | `schema.prisma:169` (`Participant[]`) | every person in a household — leads + dependents, any role | type → `<Umbrella>[]`; field arguably `householdMembers`/`members` (VOCAB sense-B). **Not** "participant" |
| c2 | `/api/roles` `{ participants }` envelope | `api/roles/route.ts:30` | **all** people incl. sysadmins/board/keyholders (role-management grid). Consumer literally does `setUsers(data.participants)` (`settings/roles/page.tsx:44`) | envelope → `{ people }` (or `{ users }`); this is the clearest misuse — the reader already calls them "users" |
| c3 | `/api/participants/search` | `api/participants/search/route.ts:17,46` (route path + `{ participants }`) | `prisma.participant.findMany` with no role filter = **every human** | rename route `/api/people/search`; envelope `{ people }` |
| c4 | membership-ops people browser | `membership-ops/participants/page.tsx` — `AdminParticipantsIndex`, `type ParticipantRow`, `results`/`sortedResults`; dir name `membership-ops/participants/` | admin browser over **all** people (consumes c3) | "people" browser; `PersonRow`; dir `membership-ops/people/` (path change — gate it) |
| c5 | certifications grid | `attendance/certifications/page.tsx:42` (`useState<Participant[]>`), `:204` ("No active participants found"), `:211` ("Participant" column header), `:104,130` | everyone with tool-cert visits — mixed roles/ages | "People" / column "Name"; local `Participant` type → `Person` |
| c6 | attendance current search | `attendance/current/page.tsx:30,52,58,165` (local `Participant` type, `Participant[]` search results) | check-in search over all people | local type → `Person`; it's a person search, not enrollees |

Notes:
- c2/c3/c4 form one chain: `/api/participants/search` → membership-ops browser,
  and `/api/roles` → roles grid. Both return unfiltered person sets.
- c1 is schema-level: the field name predates the vocabulary. Renaming the model
  to `Person` makes the type `Person[]`, at which point the field name
  "participants" for a household set is doubly wrong (it's household members).
- The local client-side `interface/type Participant` shapes (c5, c6, plus
  `membership-ops/review/page.tsx:18`, `applications/page.tsx:32`,
  `scan-service.ts:18,67`, `programs/[id]/register/dirty.ts:14`) are hand-rolled,
  independent of the Prisma rename, but carry the word and should follow.

---

## (d) Loose role-bucket findings ("volunteer"/"youth" are age/keyholder, not roles)

Two attendance surfaces bucket people by **age + keyholder flag**, then label the
buckets with role words that don't match any real role.

### d.1 `lib/getFullAttendance.ts`

| Line | Bucket | Actual rule | Label claims |
|---|---|---|---|
| 48 | `keyholderVisits` | `participant.isKeyholder` | keyholder ✅ (real) |
| 49 | `studentVisits` | `isYouth(dob)` (age < 18) | "student" — really **youth (age)** |
| 50 | `volunteerVisits` | `!isKeyholder && !youth` | "volunteer" — really **any adult non-keyholder** |
| 55 | `counts.students` | youth count | age |
| 54 | `counts.volunteers` | adult-non-keyholder count | not a real volunteer |
| 60-63 | `unaccompaniedStudents` | youth with no adult from same household present | **safety-wired** (two-deep banner, `:66`) |

`isYouth`/`youthMap` already renamed (Phase 1, #670); `student`/`volunteer`
buckets are **not** (Phase 2 pending in the proposal, and the `volunteer` bucket
was never flagged there — it's a new finding here).

### d.2 `api/facility/trends/route.ts`

| Line | Bucket | Actual rule | Label claims |
|---|---|---|---|
| 9-11 | `isStudentAtDate` | `calculateAge(dob) < 18` | "student" = **youth (age)** |
| 146-152 | student vs volunteer split | `if (student) …studentIds else …volunteerIds` | everyone **not youth** → "volunteer" |
| 169-182 | wire keys `uniqueVolunteers`, `uniqueStudents`, `totalVolunteerHours`, `totalStudentHours` | age-derived | contract leaks the misnomer |

**Divergence worth noting:** `facility/trends` "volunteer" = *every adult
including keyholders/board* (no keyholder exclusion), whereas
`getFullAttendance` "volunteer" = *adult non-keyholder*. Same word, two
populations. Neither equals the real `ProgramVolunteer` relation.

### d.3 Real role signals that DO exist on the person model (the gap)

| Signal | Where | Meaning |
|---|---|---|
| `isSysadmin` | `schema.prisma:102` | admin |
| `isBoardMember` | `schema.prisma:104` | board |
| `isKeyholder` | `schema.prisma:106` | keyholder |
| `isBackgroundCheckReviewer` | `schema.prisma:108` | bg reviewer |
| `isDeclaredAdult` | `schema.prisma:84` | age-status (25+ w/o DoB) |
| `dateOfBirth` → `isYouth` | `schema.prisma:81` / `lib/time.ts` | age < 18 |
| `HouseholdLead` | `schema.prisma:222` | guardian/lead |
| `ProgramVolunteer` | `schema.prisma:632` | **real volunteer** (program) |
| `ProgramParticipant` | `schema.prisma:643` | **real enrollee** |
| `toolStatuses` (`ToolStatus`) | `schema.prisma:110,139` | **certifier** status |
| `CorporationLead` / `CorporationMember` | `schema.prisma:559,571` | corporate |

**Gap:** none of the attendance buckets uses `ProgramVolunteer`. "Volunteer" in
attendance is a *derived age/keyholder complement*, not the volunteer role. So
there are two legitimate readings, and they need different words:

- **Attendance intent** is genuinely *"adults on the floor vs youth on the
  floor"* for the two-deep safety rule → rename buckets to `adults`/`youth`
  (honest), keep the age logic.
- If the product ever wants *real* volunteer counts, derive from
  `ProgramVolunteer`, not from `!isKeyholder`.

This overlaps the proposal's **Phase 2 (student → youth)** but adds the
untouched **volunteer bucket** and the wire-key renames. **→ OPEN QUESTION Q4:
own phase, or fold into Phase 2?**

---

## (e) `participantProjection.ts` / `HOUSEHOLD_PEER_SELECT`

`lib/household/participantProjection.ts` — exports `HOUSEHOLD_PEER_SELECT`
(`:11`) typed `satisfies Prisma.ParticipantSelect` (`:21`); the docstring says it
projects "a household peer's **Participant row**".

**Under the model rename the current VOCABULARY rule 5 inverts.** VOCAB rule 5
keeps this named `participant` *because "participant = the Person row"*. Once the
person model **is** `Person`:

- `Prisma.ParticipantSelect` → `Prisma.PersonSelect` (forced by the rename).
- The docstring "Participant row" → "Person row".
- The file/const name (`participantProjection.ts`, `HOUSEHOLD_PEER_SELECT`)
  *may* become `personProjection.ts` / keep `HOUSEHOLD_PEER_SELECT` (the const
  is relationship-scoped already — "household peer" — so it needs no change).

So: the *type* and *prose* rename mechanically; the **file/const rename is
optional and cosmetic**. Recommendation: rename the file to
`personProjection.ts` for consistency, keep `HOUSEHOLD_PEER_SELECT` as-is (it's
correctly relationship-named). **Update VOCABULARY.md rule 5** to say it projects
a `Person` row.

---

## (f) Proposed phasing (schema + FK + API + UI)

DB is wiped on deploy → migrations need no data care. Suggested order, each a
self-contained landable phase:

**Phase A — model rename `Participant` → `Person` (mechanical, highest volume).**
- `schema.prisma`: `model Participant` → `model <Umbrella>`; flip all 19
  relation-target types (§a.3). Decide FK question first (Q2): if renaming FKs,
  do `participantId` → `personId` on the 10 tables + composite ids in the same
  migration.
- `prisma migrate dev` (drop+recreate fine).
- Code: `prisma.participant` → `prisma.<umbrella>` (701 incl. tests);
  `Prisma.Participant*` types → `Prisma.Person*`; regenerate client.
- Rename fixtures/mocks across all 3 test roots (142 files) in the same phase.
- **Done-when:** `prisma.participant` and `Prisma.Participant` return 0; suite green.

#### Phase A broken into smaller, independently-green pieces

**The hard constraint.** Renaming a Prisma *model* is atomic: `model Participant`
→ `model Person` + client regen kills every `prisma.participant` accessor and
every `Prisma.Participant*` type in one shot — tsc is red until all ~701 sites
change. That step can't be merged half-done. Strategy: **move everything NOT tied
to the model name out of the atomic flip first**, in small green PRs, leaving a
final flip that is purely mechanical.

Order so each PR compiles and the suite stays green:

**A0 — hand-rolled local `Participant` types (prep, freely sliceable).**
Client-side `interface/type Participant` shapes that are *not* the imported
Prisma type: `attendance/current/page.tsx:30,58`, `certifications/page.tsx:42`,
`membership-ops/review/page.tsx:18`, `applications/page.tsx:32`,
`programs/[id]/register/dirty.ts:14`. Rename → `Person`. Independent of the model;
each a tiny green PR. **Verify per file it's a local shape, not
`import { Participant } from generated/prisma`** (those belong to A2).

**A1 — FK columns + relation fields, per-model (the Q2 rename), model still named
`Participant`.** Prisma allows `person Participant @relation(fields:[personId])`
while the model keeps its old name — so this lands *before* the flip, sliced one
model at a time. Each slice: rename that model's `participantId` → `personId`
(+ composite `@@id`/`@@index`), relation field `participant` → `person`,
`migrate dev`, and the code touching *that model's*
`x.participant`/`participantId`/`include:{participant}`. Green because other
models are untouched. The 10 FK-bearing models (group the trivial ones):

| Slice | Model(s) | schema |
|---|---|---|
| A1a | Visit | `:775` |
| A1b | RSVP, FeePayment | `:739,694` |
| A1c | ProgramParticipant, ProgramVolunteer | `:656,638` |
| A1d | HouseholdLead, ToolStatus | `:229,147` |
| A1e | CorporationLead, CorporationMember | `:566,578` |
| A1f | RawBadgeLog | `:754` |

(`reviewerId`, `disclosedById`, `decidedById`, `leadMentorId`,
`attendanceConfirmedById`, `userId` do **not** contain "participant" — untouched
by A1; they only flip *type* in A2.)

**A2 — the atomic model-name flip (last, one PR, mechanical).** With FKs already
`personId`, this is purely: schema `model Participant` → `model Person` + the 19
relation *target* types `Participant` → `Person`; `prisma generate` +
`migrate dev`; find/replace `prisma.participant` → `prisma.person` and
`Prisma.Participant*` → `Prisma.Person*`; fixtures/mocks across all three test
roots. **Cannot be sub-split** (accessor derives from the model name) but is a
pure mechanical rename — low review risk. `participantProjection.ts` type/prose
flip here too (see §e; file rename optional).

Net: Phase A = **A0 (n tiny PRs) → A1a–A1f (6 green slices) → A2 (one atomic
mechanical flip)** — instead of one ~1700-hit megamerge.

**Phase B — mixed-people API + UI (the §c misuse).**
- `/api/roles` envelope `participants` → `people`; consumer
  `settings/roles/page.tsx:44`.
- `/api/participants/search` → `/api/people/search`; envelope; membership-ops
  browser dir + `ParticipantRow` → `PersonRow` (path change — gate w/ Q3).
- certifications + attendance-current local types/labels → `Person`/"People".
- `Household.participants` field → `householdMembers` (or `members`) — coordinate
  with the sense-B `householdMember` convention from Phase 3 (#674).
- **Done-when:** no mixed-people set is labelled "participant" in API or UI.

**Phase C — loose attendance buckets (the §d cleanup).**
- `getFullAttendance.ts`: `studentVisits`→`youthVisits`,
  `unaccompaniedStudents`→`unaccompaniedYouth`, `counts.students`→`counts.youth`,
  `volunteerVisits`→`adultVisits`(already exists as helper)/`counts.volunteers`→
  `counts.adults`.
- `facility/trends`: `isStudentAtDate`→`isYouthAtDate`,
  `uniqueStudents`/`studentHours`→youth, `uniqueVolunteers`/`volunteerHours`→
  `adults` (or keep "volunteer" if product wants it derived from
  `ProgramVolunteer` — different work). Wire keys + `facility-ops/trends`
  consumer in the same commit.
- **Done-when:** attendance buckets named by what they measure (age/keyholder),
  or by real roles; safety two-deep logic unchanged.

**Relationship to the existing proposal:** Phase C largely equals proposal
Phase 2 (student→youth) plus the volunteer bucket. Phase A/B are new (the
proposal deliberately *kept* the person model as `Participant`). Adopting this
report means amending `VOCABULARY.md` rule 2a + rule 5 and the proposal §2.

---

## (g) OPEN QUESTIONS — answers recorded (2026-07-01)

- **Q0 — Adopt the repositioning?** Reframed: this is not a reversal, it
  **corrects an internal inconsistency** in `VOCABULARY.md` (bare `participant`
  for "the human" contradicts the doc's relationship-based thesis + the
  no-bare-noun core rule). See the callout under the header.
  **Answer:** Yes — user confirmed the framing ("you caught an inconsistency —
  reread the rules"). Adopt; amend VOCABULARY.md rule 2a + rule 5 rationale.
- **Q1 — Umbrella word.** `Person` is the word the doc's own UI-word column
  already uses for the Person concept; `User` collides with NextAuth `userId`
  FKs.
  **Answer:** **`Person` — FINAL, not provisional.** Confirmed by user.
- **Q2 — FK rename `participantId` → `personId`?** (incl.
  `ProgramParticipant.participantId`, the person-FK on the enrollee join).
  **Answer:** **YES.** Rename FK columns to `personId`. ~doubles the diff (997 vs
  701 hits), zero DB risk (DB wiped on deploy). `ProgramParticipant.personId` is
  the accepted end-state.
- **Q3 — Mixed-people screens.**
  **Answer:** **Umbrella word + rename paths.** `/api/participants/search` →
  `/api/people/search`; `membership-ops/participants/` → `.../people/`; roles/
  cert/browser identifiers + envelopes → `people`/`Person`. Path changes
  approved.
- **Q4 — Volunteer/youth attendance bucket cleanup (§d, Phase C).**
  **Answer:** **PAUSED.** User reports a **logic problem found elsewhere** and a
  **chip already in flight to fix `facility/trends`**. Do **not** act on §d /
  Phase C yet — awaiting more info from the user before scoping the bucket
  rename. `getFullAttendance.ts` findings stand as documentation only for now.
- **Q5 — `participantProjection.ts` file/const rename?** Type + prose flip to
  `Person` regardless of choice.
  **Answer:** _pending_ — low priority; recommend file → `personProjection.ts`,
  keep `HOUSEHOLD_PEER_SELECT` (already relationship-named).
</content>
</invoke>
