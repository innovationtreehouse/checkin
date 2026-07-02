# Canonical Vocabulary

The one place that defines what each people/household word means in this
codebase. The vocabulary is built on **relationships, not loose nouns**: a person
is named by *which relationship you are viewing them through*. The same human
legitimately carries several names at once — a kid is a **household member** on
the household screen and a **participant** on a program screen. That is not a
collision to "fix"; it is the model working as intended.

## The core rule

**Never a bare `member` / `Member` / `Membership` — in code OR UI.** It is always
qualified by the relationship's target: **Org** or **Household**. A screen or
identifier that just says "member" is a bug against this dictionary.

## The relationships

| Concept | Relationship | UI word | Code identifier | Model / table | Path |
|---|---|---|---|---|---|
| **Person** | the human (any human: staff, volunteer, youth, lead, enrollee) | name / "person" | `person` | **`Person`** (umbrella model — rename from `Participant`, pending; see migration status) | — |
| **Org Membership (A)** | Person/household ↔ **Organization** | **"Treehouse Member"** | `isActiveOrgMember`, `orgMember…` | `OrgMembership` (rename from `Membership`) | `/api/shop/org-members` |
| **Household** | grouping of people | "household" (warm: "family") | `household` | `Household` | `/api/household` |
| **Household Membership (B)** | Person ↔ **Household** | "household member" | `householdMember` | `householdId` FK + `HouseholdLead` (lead variant) | `/api/household/member` |
| **Program relationship** | Person ↔ **Program** | **"participant"** | `programParticipant` | `ProgramParticipant` | — |

## Rules stated explicitly

1. **No bare member/Member/Membership.** Qualify with the target — **Org** or **Household** — every time, in code and UI.
2. **`participant` means ONLY a program enrollee** (`ProgramParticipant` / the Program relationship). It is NOT the person model and NOT a generic word for "any person." The umbrella person model is **`Person`**. **Admin and volunteers are never "participants."**
3. **Anything showing MIXED people uses the umbrella, not "participant."** A screen or API listing staff/volunteers/youth/leads together is `Person`/"person"/"people", or an explicit role bucket — never "participants".
4. **A person carries multiple relationship-names at once.** Same human, different relationship on different screens (household member here, program participant there, Treehouse Member elsewhere). Do not "reconcile" these into one word.
5. **The `/api/household/member` route stays put.** The `/household/` path segment already qualifies "member" as the household relationship — do NOT move it to `/participant`.
6. **`participantProjection.ts` / `HOUSEHOLD_PEER_SELECT` project a Person row** — they rename *with* the model (→ person projection), they are NOT the enrollee sense.

## Person sub-classifications (orthogonal to the relationships above)

These describe *what kind of person*, independent of which relationship you're viewing:

| Term | Meaning | Code | Copy |
|---|---|---|---|
| **Youth** | Under 18 — an **age** classification (`isYouth(dob)`). Absorbs the age-synonym **minor** only. | `youth` / `isYouth` | "youth" |
| **Child** | The lead's **offspring / kin** — a **relationship**, age-independent (a 25-year-old is still their parents' child). Distinct from `youth` (age) and `dependent` (non-lead). | `child` | "child" / "children" |
| **Student** | A **pre-college program enrollee** — derived from `ProgramParticipant`, **NOT an age test.** | `student` (enrollment contexts only) | "student" only where truly an enrollee |
| **Dependent** | A **non-lead** household member a lead acts for; broader than `child` (a non-lead adult non-offspring is a dependent, not a child). | non-lead subset of `householdMember` | "someone in your household" |

## Coding rules for the above

- **Code identifiers AND comments/prose** use the canonical word. No `minor`, no
  loose `dependent`, no bare sense-B `member`, in identifiers *or* comments.
  **`child` is allowed** — it is a valid relationship term (offspring); keep it
  where it means "a lead's child", and use `youth` only for the under-18 age.
- **API wire keys are a contract**, not a free rename. A serialized request/
  response key changes only in the phase that owns that contract, all consumers
  moved together. Rename surrounding vars freely; leave the key until its phase.
- Age is always derived from `dateOfBirth` via `isYouth` — never re-implement an
  age check inline.

## Migration status

The term-by-term migration plan lives in
[designs/PARTICIPANT_TERMINOLOGY_PROPOSAL.md](designs/PARTICIPANT_TERMINOLOGY_PROPOSAL.md).

- **Phase 1 — youth** (`minor`/`isMinor` → `youth`/`isYouth`): shipped (#670) + a comment-scrub followup. `child` deliberately preserved.
- **Phase 3 — householdMember** (sense-B bare `member` → `householdMember`, route kept at `/api/household/member`): shipped (#674, branch `claude/determined-bell-70bb18`). Program-enrollee `programParticipants` correctly stays. Prisma `participant`/`participantId` were left untouched by Phase 3 — **not because they're canonical** (they're the person model, which rule 2 no longer calls "participant") but because renaming them belongs to the Person-umbrella migration (→ `person`/`personId`), not the household phase.
- **Phase 2 — student**, **Phase 4 — OrgMembership**, **Phase 5 — household/family**, **Phase 6 — dependent**: pending.
- **Person umbrella** — rename `model Participant` → `Person` (and `participantId` FKs → `personId`, TBC), freeing "participant" to mean only the program enrollee; requalify every mixed-people "participant" label. Large schema migration — under investigation (report: [designs/PERSON_UMBRELLA_INVESTIGATION.md](designs/PERSON_UMBRELLA_INVESTIGATION.md), chip `task_e6b621d7`) before it's specced as a phase.

## Known semantic bugs (see proposal §3)

- **BUG-1:** attendance/facility "student" is computed from age (`isYouth`), not enrollment — should be `youth`. Fixed in Phase 2.
- **BUG-2:** `intake.ts` `children` bucket = every non-lead participant (really *dependents*, not offspring/age). Addressed in Phase 6.
</content>
