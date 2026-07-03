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
| **Person** | the human (any human: staff, volunteer, youth, lead, enrollee) | name / "person" | `person` | **`Person`** — the umbrella model. **Shipped** (`model Person`; `prisma.person`; `personId` FKs). | — |
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

## Named entities (not a person, but carry multi-layer names)

### Trusted Adult

`model TrustedAdult` is an **authorization record**, NOT a person. It involves two people:

- **`disclosedBy`** — the **subject**: the Person who entered the disclosure.
- **`trustedAdult*`** — the **adult being trusted**: `trustedAdultName` / `trustedAdultPhone` / `trustedAdultEmail`, plus an optional Person link `trustedAdultPerson` / `trustedAdultPersonId`. Historically called the **"counterparty"** (the adult on the other side of the disclosed relationship); that word now survives **only in explanatory prose**, never as an identifier.

**Synonyms for the SAME concept across layers** (so a reader isn't misled):

| Layer | Name |
|---|---|
| Model / DB / relations | `TrustedAdult` (the record) |
| Adult's fields on the record | `trustedAdult*` |
| Policy prose | "dual relationship" |
| Member / board UI label | **"Trusted Adult"** |
| Operational (front-desk) UI label | **"Pickup"** |

**NOT synonyms:**
- **"guardian" / "guardianship"** — a household lead/parent, or a relationship *type* — never this entity.
- **`familyContext`** — a distinct *attribute* of the record (the board-facing explanation), not another name for it. (Its own fate is the household/family phase.)

Source: `counterparty*` → `trustedAdult*` rename — **shipped** (audit P2-2, #734; scalar fields + Person FK, RENAME migrations). The schema carries this same glossary inline above `model TrustedAdult`.

## Program hierarchy (LOCKED)

Product-owner decision — **design to these; do not relitigate the names or shape.**

**Program → Instance → Event** = **definition → offering → occurrence.**

| Level | Semantics | Meaning | Code | UI |
|---|---|---|---|---|
| **Program** | definition | a **reusable definition / template** — a catalog entry (e.g. "Woodworking 101") | `Program` | "Program" |
| **Instance** | offering | one **concrete offering / run** of that program (e.g. "Fall 2026 Woodworking") | **`ProgramInstance`** — **never** a bare `instance` / `instanceId` (too generic) | "Instance" |
| **Event** | occurrence | a **dated occurrence / meeting** people check into | `Event` (today's `Event` row **is** this leaf — it stays the leaf) | "Event" |

Rules:
- The middle layer's model name is **`ProgramInstance`** in code; bare `instance`/`instanceId` is banned (ambiguous).
- `Event` is unchanged — it remains the check-in leaf; the Instance layer is inserted **above** it, not in place of it.

---

# Additions from the 2026-07-02 vocabulary sweep

Source: the 2026-07-02 vocabulary sweep. The followup ledger of the renames these
entries imply — plus open items and dismissed candidates — is
[designs/UNFINISHED.md](designs/UNFINISHED.md). Terms below are **product-owner
decided**; where the code hasn't caught up yet it's marked *(rename pending)* and
tracked in UNFINISHED.md.

## Volunteer & program roles

**Never a bare `volunteer`** — the word is one umbrella over three distinct
children. And **the Treehouse is 100% volunteer: there is no "staff."**

| Concept | Meaning | Code | UI |
|---|---|---|---|
| **Treehouse Volunteer** | umbrella: a BG-checked, board-approved adult who volunteers — **program-optional** (a bookkeeper is one, with no program) | — | "volunteer" |
| **Volunteer Family** | a Member Family with **no youth/student enrolled**, whose adults volunteer → **reduced membership fee** | `Membership.isVolunteer` (rate) + `VolunteerDesignation` (email pre-auth) — **one concept** | "Volunteer-only family" |
| **Program Volunteer** | a Treehouse Volunteer assigned to a **specific program** | `ProgramVolunteer` (`isCore` → **Core Volunteer**) | "Volunteer" / "Core Volunteer" |
| **(attendance) volunteer bucket** | courtesy label for present adults — **not a role**; deliberately loose, UI-safe | derived in attendance | "Volunteers/Adults" |

Program roles (all Treehouse Volunteers):

| Role | Meaning | Code | Notes |
|---|---|---|---|
| **Program Leader** | the person responsible for a program | `programLeaderId` *(rename pending from `leadMentorId`)* | policy term; **retire "lead mentor"** |
| **Program Volunteer** | program helper; **Core Volunteer** = the authorized subset who can run it | `ProgramVolunteer.isCore` | Core's legal-authority rules are organizational (out of software scope) |

**Retired words (do not use):** `staff` / "program staff" (→ Treehouse
Volunteers), `mentor` and `lead mentor` (→ Program Leader / Program Volunteer;
program-specific "mentor" language is external), "program instructor"
(→ see Certification — `instructor` is **tool-only**).

## Shop & Certification vocabulary

`Tool` = the **equipment**. A person's competency **on** a tool is their
**certification level** (`ToolStatus`); the rungs are the **certification levels**
(`ToolLevel`; policy word: "tool rating"). Color and word **align intentionally**
(the dot-color UI view bridges them) — interchangeable, record both:

| Rank | Color | Enum (`ToolLevel`) | Label | Meaning | Min age |
|---|---|---|---|---|---|
| 0 | No Dot | *(no `ToolStatus`)* | "Uncertified" | hasn't used the tool here | — |
| 1 | Red | `BASIC` | "Basic" | knows basic safety | 10 |
| 2 | Green | `CERTIFIED` | "Certified" | safe & successful; solo only with a **Tripod** | category-based |
| 3 | Yellow | `DOF` | "DOF" | **Defender of the Finger** — keeps their head when things go wrong | 13 |
| 4 | Blue | `INSTRUCTOR` | "Instructor" | can teach others | 13 |
| 5 | — | `MAY_CERTIFY_OTHERS` | **"Tool Certifier"** | board-appointed; can change a user's certification level | 21 |

Rules:
- **Canonical top label = "Tool Certifier"** *(retire "Shop Certifier")*.
- **`instructor` is tool-only** — "program instructor" is banned.
- **Enum rank ≠ declaration order** — real rank is `BASIC < CERTIFIED < DOF <
  INSTRUCTOR < MAY_CERTIFY_OTHERS`; make it explicit in the enum *(pending)*.
- **Tool Certifier is per-tool for *granting*** (you may only certify others on a
  tool you certify); it's treated as a global flag for *nav/visibility* only —
  accepted (small group).
- **Age gates + tool categories are policy-enforced outside the software** today
  (aspirational to model).

## Money vocabulary

**The canonical money word is `fee`.** Kinds: **membership fee** *(rename pending
from "dues": `normalDuesCents`→`standardMembershipFeeCents`,
`volunteerDuesCents`→`volunteerMembershipFeeCents`)*, **program fee** (`Fee`),
plus **shop fee** and **facility fee** (shop and facility are billed separately).
`price` = the cents **amount** on a fee, not a rival concept.

**Payment vs relief** (keep separate):
- **Manual payment** — payment landed **outside Shopify** (recorded in QuickBooks),
  so a membership activates without a Shopify order. `via: "manual"` /
  `manualPaymentById` *(rename pending from `"certified"` / `certifiedById` —
  which collided with tool certification)*. **Not** a comp.
- **Payment Plan** — installments (`isPaymentPlanRequested`).
- **Scholarship** — a board comp (fee waived). Unnamed in code today.

## Attendance / check-in

One activity, a pipeline of distinct stages — name each; keep the scoped verbs:

**scan** (badge tap at a **kiosk**) → **`RawBadgeLog`** (raw event) → **`Visit`**
(the attendance record; `VisitSource`) → **attendance** (the rollup view).

- **"check-in" / "check-out"** = the **action**; **"attendance"** = the **view**;
  `Visit` = the internal record. Both "check-in" and "attendance" are canonical in
  their own scope — do not collapse.

## Shop vs Facility (distinct billable domains — not a collision)

- **Shop** = the makerspace: tools, certifications, shop safety; billed separately.
- **Facility** = the building / attendance / access domain; billed separately.
- These are intentionally distinct (separate billing + the shop's own safety
  rules). The only real overlap to disambiguate: **Shopify** also uses "shop".

## Roles & accounts

- **Keyholder** (`isKeyholder`) — a **board-anointed policy role**: a Member who
  can open a Treehouse Facility; carries facility-rules/emergency responsibility.
  It's a standing role, not a presence status (attendance code merely reads it).
- **Board Member** (`isBoardMember`) — a governance role; **distinct from the
  OrgMembership "Treehouse Member"** (a Board Member need not be a Treehouse
  Member). Not the bare-`member` this dictionary bans.
- **Treehouse Account** — an internal org-domain (`@innovationtreehouse.org`)
  account; not a real Member Family. `isTreehouseAccount` *(rename pending from
  `isStaffAccount`; also `STAFF_ENTERED`)*.
- **Admin** — ⚠️ **UNRESOLVED / do not rely on.** "admin" is a loose derived label
  (no `isAdmin` column) that means `isSysadmin` in some files and
  `isSysadmin || isBoardMember` in others. Security-sensitive; deferred to its own
  discussion — see [designs/UNFINISHED.md](designs/UNFINISHED.md).
- **Review / Reviewer** — ⚠️ overloaded across BG-reviewer role, attestation
  reviewer, membership review, and trusted-adult "decider"; a lower-priority
  followup (UNFINISHED.md). Never use "review" bare until resolved.

## Person sub-terms (additions)

| Term | Meaning | Code |
|---|---|---|
| **Adult** | 18 or older (policy); normally derived from `dateOfBirth` | — |
| **Declared Adult** | a **self-asserted "25+"** with **no DoB captured** (PII minimization) — a valid subset of Adult. 25 (not 18) = the age past which no program-run restriction applies (Close-in-Age safe line) | `isDeclaredAdult` |
| **Visitor** | a person who is **not a Member** (a non-member at a Location/Event) | `isStaffAccount`-adjacent; scope `all_current_visitors` |

**`Visitor` vs `Visit`** — a **non-member person** vs an **attendance record**;
they share a root but are unrelated. Accepted near-collision — no rename, just
know the difference.

## Supervision terms (safety vocabulary)

- **Tripod** — the presence of **3 Members, each ≥ 9 years old**, in an area that
  is **Observable and Interruptible**; lets a Certified (Green) work solo. *(policy
  term; not modeled in code)*
- **Two Deep** — two unrelated, non-Student adult Treehouse Volunteers from
  different households. *(the attendance keyholder/volunteer buckets implement this)*
- **Observable and Interruptible** — no locked doors; another adult can see or
  hear and could enter. *(not modeled)*
- **"dedicated" (DOF/Instructor)** — means "actively watching you use the tool"
  (not wandering). **Not software-enforceable — ignore in code.**

## Named entities (additions)

- **Emergency Contact vs Trusted Adult** — both are non-household people attached
  to a household, and **may be the same person, but the sets are not identical —
  do not merge.** Emergency Contact (`EmergencyContact`) = **who we call in a bad
  situation**; Trusted Adult (`TrustedAdult`, UI "Pickup") = **who may pick up /
  transport / be alone with a child.**
- **MembershipProcess = the membership "application"** — technically an intake
  process, called an **"application"** because it includes a background check
  (vendor **Averity**) and **can be rejected**. One `MembershipProcess` = one
  cycle (`INITIAL` or `RENEWAL`); `INTAKE` is its first stage.
- **Corporation** (`Corporation` / `CorporationLead` / `CorporationMember`) —
  **aspirational**, for the policy's **Organizational Partner Member** (partner
  orgs running programs). No corporate partners today; keep as scaffolding, and
  qualify the bare `CorporationMember` when it's built.

## Reference facts

- **Membership Year** = **Sept 1 – Aug 31** (policy); `membershipYearBoundary`
  stays configurable by design.
- **Single facility** — check-in happens only at the one Treehouse Facility;
  multi-location is not on the roadmap (`RawBadgeLog.location` free-text is fine).
- **Integration vendors** — **Averity** (background check; aka "VERITY"), **Zoho**
  (e-sign / import), **Shopify** (payment).
- **Treehouse Card** — any corporate/business/debit/credit card opened on the
  Treehouse EIN (reserved for future financial rules).

## Migration status

The term-by-term migration plan lives in
[designs/PARTICIPANT_TERMINOLOGY_PROPOSAL.md](designs/PARTICIPANT_TERMINOLOGY_PROPOSAL.md).

> **Pattern for big Prisma model renames** (learned from `Participant`→`Person`): a model rename is *atomic* — tsc is red until every accessor/type flips, so it can't merge half-done. Pull everything NOT tied to the model name (local types, then per-model FK renames — Prisma allows `person Participant @relation(fields:[personId])`) into small green PRs first, leaving a final purely-mechanical name flip. See git history #680–#708 (Person) and #735 (OrgMembership).

**✅ Shipped to `main`:**
- **Youth** — `minor`/`isMinor` → `youth`/`isYouth`; `minor` fully scrubbed from src + tests. #670, #673, #676. (`child` deliberately preserved.)
- **Student** — age-based `student` identifiers → `youth` (BUG-1). #679. `isStudent`/`studentVisits` = 0.
- **householdMember** — sense-B bare `member` → `householdMember`; route kept at `/api/household/member`. #674.
- **Person umbrella** — `model Participant` → `Person`, `participantId` FKs → `personId`, and every mixed-people "participant" requalified to `people`/`Person`. Landed as sliced PRs: A0 #680 → A1a–f (#692/#691/#686/#690/#681/#684) → A2 atomic flip #708; B1 roles envelope #711, B2 `/api/people/search` #710, B3 `Household.householdMembers` #712, B4 cert grid #709. `prisma.participant` = 0; `model Person` at `schema.prisma:62`. `ProgramParticipant.personId` is the accepted end-state (a program-participant row whose person is `personId`).
- **OrgMembership — read-model + price + path + copy** (Phase 4a/b/c): `lib/membership.ts` → `lib/orgMembership.ts`, `isActiveMember` → `isActiveOrgMember`, `ACTIVE_MEMBER_*` → `ACTIVE_ORG_MEMBER_PERSON_WHERE`/`_INCLUDE` (#729); price fields → `orgMemberOnly`/`orgMemberPriceCents`/`nonOrgMemberPriceCents` (#731); `/api/shop/members` → `/api/shop/org-members` (#732); UI copy → "Treehouse Member" (#729).
- **Trusted Adult** — `counterparty*` → `trustedAdult*` (scalar fields + Person FK, RENAME migrations); audit P2-2 (#734).

**⬜ Remaining:**
- **OrgMembership — the Prisma model rename** (the rest of Phase 4): `model Membership` (`schema.prisma:296`) → `OrgMembership`, `MembershipProcess` (`:315`) → `OrgMembershipProcess`, the `MembershipStatus` enum, and `membership-ops/*` dir/route/nav propagation. Read-model/price/path/copy already shipped (above). Scoping under investigation (chip `task_9ecbb0f5`).
- **household / family** — Q2 default is *keep the split* (`Household` in code, "family" in warm copy). `familyContext` (`schema.prisma:498`) stays. Effectively a doc-note unless someone chooses "unify".
- **dependent** — `emailDependentCheckins` key + copy → household wording; plus BUG-2 (`intake.ts` `children` bucket = non-lead participants). Small.

**⬜ Remaining (from the 2026-07-02 sweep — see [designs/UNFINISHED.md](designs/UNFINISHED.md)):**
- **Program Leader** — `leadMentorId`→`programLeaderId`, relation `ProgramLeadMentor`→`ProgramLeader`, `leadMentorNotificationSettings`→`programLeaderNotificationSettings`, "Lead Mentor" UI→"Program Leader" (~256 refs). Retire "lead mentor"/"mentor".
- **Retire "staff"** — "program staff"→Treehouse Volunteers; `isStaffAccount`→`isTreehouseAccount` + `STAFF_ENTERED` (account sense = **Treehouse Account**).
- **Money → fee** — "dues"→"membership fee" (`normalDuesCents`→`standardMembershipFeeCents`, `volunteerDuesCents`→`volunteerMembershipFeeCents`).
- **Manual payment** — `via:"certified"`→`via:"manual"`, `certifiedById`→`manualPaymentById` (was colliding with tool certification).
- **Tool Certifier** — retire "Shop Certifier" label; make `ToolLevel` rank explicit in the enum.
- **`SessionUser`** — consolidate the ≥4 inline redeclarations into one export; rename stale `types/participant.ts`.

**⚠️ Open (deferred, not yet decided):** **admin** role-set (sysadmin vs sysadmin+board — security-sensitive) and **review/reviewer** overload. Both in UNFINISHED.md.

**Closed:** attendance "volunteer = adult non-keyholder" / "youth = minor" buckets — **won't-change** (intended supervision signal, safety-load-bearing two-deep; do not enrollment-ify). Trends age-proxy metric fixed separately. Recorded in [designs/UNFINISHED.md](designs/UNFINISHED.md) "Considered and dismissed".

**Related track (sibling audit, not one of the phases above):** Trusted Adult entity naming `counterparty*` → `trustedAdult*` — **shipped** (audit P2-2, #734). See the Trusted Adult entry above.

## Known semantic bugs (see proposal §3)

- **BUG-1:** attendance/facility "student" is computed from age (`isYouth`), not enrollment — should be `youth`. Fixed in Phase 2.
- **BUG-2:** `intake.ts` `children` bucket = every non-lead participant (really *dependents*, not offspring/age). Addressed in Phase 6.
</content>
