# Participant Terminology Proposal

**Status:** proposal / investigation only — no code changed, no migrations run.
**Scope:** naming & terminology across the check-in app. Recommends a canonical
vocabulary and a **term-by-term** rename plan — each term is one self-contained
phase, carried through *every* layer (identifiers, copy, API contract, schema +
migration) so it lands fully and is never half-renamed.
**Author's stance:** finish each word completely before starting the next.
Schema changes are on the table where they retire real confusion.

**Deploy assumption (simplifies everything schema-touching):** databases are
**emptied on deploy**. Migrations only need to land the correct final schema —
**no data migration, no backfill, no data-preservation care**. A column or JSON
key can be renamed outright; existing rows are gone anyway. This removes the
only expensive parts of Phases 5 and 6.

All line numbers below were re-verified against the tree at time of writing.

---

## 0. Ground truth (models, not words)

| Concept | Where it lives | Note |
|---|---|---|
| A person | `model Participant` — `prisma/schema.prisma:62` | The ONLY person model. |
| A group of people | `model Household` — `schema.prisma:153` | 1 household : N participants (`householdId` on Participant, `schema.prisma:95`). |
| Org membership (A) | `model Membership` (1:1 household, `schema.prisma:296`) + `model MembershipProcess` (`schema.prisma:315`) → **renamed to `OrgMembership`/`OrgMembershipProcess` in Phase 4.** | The org-membership relationship + lifecycle. Bare "Membership" is banned — it's the **Org** relationship. |
| Guardian / responsible adult | `model HouseholdLead` (`schema.prisma:222`) | A participant flagged as a lead. Being a **non-lead does not imply youth or student.** |
| Age | `dateOfBirth` (`schema.prisma:81`); canonical `isMinor(dob) = age < 18` in `src/lib/time.ts:95` | |
| Corporate membership | `Corporation` / `CorporationLead` / `CorporationMember` (`schema.prisma:539,559,571`) | A *fourth* "member" sense — noted so nobody renames into it. |

There is no `Member`, `Youth`, `Child`, `Student`, or `Dependent` model. Every
one of those words is UI/vocabulary sitting on top of `Participant`.

---

## 1. Collision inventory

Tagged by the meaning each use actually carries. Non-test production code except
where a test name is the clearest evidence of intent. `member` has 1078 non-test
hits — inventoried by *sense* with representative anchors.

### 1a. `member` / `members`

**Sense A — "active member"** = Participant whose household `Membership.status === ACTIVE`.

| File:line | Use |
|---|---|
| `src/lib/membership.ts:12,30,44` | `ACTIVE_MEMBER_PARTICIPANT_WHERE`, `isActiveMember`, `participantRecordIsActiveMember` (canonical) |
| `src/app/api/shop/members/route.ts:11-12` | `findMany({ where: ACTIVE_MEMBER_PARTICIPANT_WHERE })` |
| `prisma/schema.prisma:600,612,615,670,673` | `memberOnly`, `memberPriceCents`, `nonMemberPriceCents` (Program + Fee) |
| `src/app/programs/[id]/page.tsx:193-199,290-291` | `isMember = membership.status === "ACTIVE"`; "Member Price" |
| `src/app/membership-ops/layout.tsx:41,98` + `api/nav/todo-counts/route.ts:353` | `memberFamilies` |

**Sense B — "household member / participant"** = ANY Participant in a household, membership-agnostic.

| File:line | Use |
|---|---|
| `src/lib/household/activityMembers.ts:15,28` | `activityMembers()`, `canActFor()` — **canonical sense-B helper** |
| `src/app/api/household/member/route.ts` | path `/api/household/member`; `targetMember`/`updatedMember` are plain participant rows; "Only household leads can edit members" (`:37`) |
| `src/app/api/events/mine/route.ts:14-16` | `memberIds` = household participant ids |
| `src/app/my-household/page.tsx:45,66-67,376,435` | `type Member`, "Household Members", "Add Household Member" |
| `attendance/current/page.tsx:363,371,436`, `attendance/household/page.tsx:61,71`, `safety/emergency-contacts/page.tsx:144` | "Household Members" / "Member" / "No enrolled members" |
| `shop-ops/manage/ToolManagementPanel.tsx` | `type Member` etc — **population is sense A**, word is sense B |

**Sense C — lifecycle** (leave): `Membership`, `MembershipProcess`, `membershipStatusBlocksLogin`, `membership-ops/*`.
**Sense D — role** (leave): `isBoardMember` (`schema.prisma:104`).
**Sense E — corporate** (leave): `CorporationMember` (`schema.prisma:571`).

### 1b. `youth` / `child` / `minor` — under-18

| File:line | Word | Meaning |
|---|---|---|
| `src/lib/time.ts:95` | `isMinor` | **Canonical: age < 18** |
| `api/roles/route.ts:25` + `settings/roles/page.tsx:122` | `youth` / "Hide Youth" | **Already the "youth" precedent** |
| `api/profile/route.ts:36` | "Youth profiles are read-only." | age |
| `membership/page.tsx:571,572,579` | "Children", "+ Add child", "Child {i+1}" | under-18 |
| `membership-audit/broken/page.tsx:78` | badge "minor" | under-18 |
| `safety/pickup/page.tsx:53` | "pick up children" | under-18 (parent copy) |
| `programs/[id]/register/page.tsx:246` | placeholder "Child or Adult Name" | under-18 |
| `isMinor` consumers (non-test): `membership-ops/participants/new/page.tsx`, `profile/page.tsx`, `api/profile/route.ts`, `api/profile/onboarding-status/route.ts`, `membership-audit/broken/page.tsx`, `getFullAttendance.ts` | | age |

**REVISED (supersedes the original brief):** only **`minor`** is a pure age-synonym
of `youth`. **`child` is NOT** — it's a *relationship* (the lead's offspring),
age-independent: a 25-year-old is still their parents' child. So `child` stays a
valid, distinct term (see §2) and must NOT be renamed to `youth`. Use `youth`
only when the point is genuinely the under-18 age.

### 1c. `student` — should mean "pre-college program enrollee"; code computes it from AGE

| File:line | Definition used | Problem |
|---|---|---|
| `attendance/current/page.tsx:40,84,90,427` | `isStudent = age < 18`; "Students" column | student == youth |
| `lib/getFullAttendance.ts:45,49,60-61` | `studentVisits = minors`; `unaccompaniedStudents` → two-deep safety | age-based **+ safety-wired** |
| `api/facility/trends/route.ts:8,146,169-182` | `isStudentAtDate = age < 18`; `uniqueStudents`, `studentHours` | age-based |
| `facility-ops/trends/page.tsx:133` | "Students" column | age-based |
| `membership-ops/participants/new/page.tsx:40,146,154` | `studentSelected = isMinor(dob)`; "Student Detected" | age-based |
| `types/attendance.ts:48`, `page.tsx:162`, `attendance/current:406` | `students`, "unaccompanied student" | age-based |

**No use of `student` means "enrolled in a program regardless of age".** Every current use is age-in-disguise.

### 1d. `dependent`

| File:line | Context | Meaning HERE |
|---|---|---|
| `communication/page.tsx:11,27,41` + `lib/notifications.ts:86,150` | `emailDependentCheckins` setting | household member (not self) whose check-ins notify a lead |
| `trusted-adults/page.tsx:12` | "belongs to lead, not dependents" | **non-lead** member |
| `pageRegistry.ts:26,66` | "a youth/dependent must not see them" | non-lead / managed |
| `my-household/page.tsx:443` | "a student dependent who will not sign in themselves" | member with **no own login** |
| `membership-ops/participants/import/page.tsx:138` | "students or dependents, leave Email blank" | no own email/login |
| `api/programs/[id]/participants/route.ts:64` | "enrolling their own self/dependent" | member a lead enrolls |
| test `programsParticipantsAPI…:27,96,103` | **"dependent (25yo)"** | **NOT age-based** |

**Derived meaning:** a household participant the lead is responsible for — the
**non-lead subset** of household members, often (not always) without their own
login. The 25yo fixture proves it is **not** age-based.

### 1e. `participant` — the canonical word, already used well
`membershipOpsNav.ts:14,31`; `program-ops/programs/[id]/page.tsx:395` ("Participants Enrolled"); `model ProgramParticipant` (`schema.prisma:643`).

### 1f. `household` vs `family`

| File:line | Word | Facing |
|---|---|---|
| `schema.prisma:476` | `TrustedAdult.familyContext` | **persisted column**; board-facing note |
| `safety/trusted-adults/page.tsx:49,188` | `familyContext`, "Family context (board only)" | user |
| `my-household/page.tsx:353` | "Volunteer-only family" | user |
| `membership-ops/review/page.tsx:137` | "volunteer only family" | user |
| `programs/[id]/register/page.tsx:199` | "Family Information" | user |
| `membership-ops/layout.tsx:41,98` + `todo-counts/route.ts:353,364` | `memberFamilies` | internal + counter |
| `volunteer-memberships:71`, `participants:278`, `my-activities/*` | "family" | user |

---

## 2. Canonical vocabulary (target end-state)

> Lives as a standing reference at [`docs/VOCABULARY.md`](../VOCABULARY.md) (Phase 0), which is the source of truth. **The vocabulary is relationship-based**: a person is named by which relationship you view them through, and the same human holds several names at once (household member on one screen, participant on another). **Bare `member`/`Membership` is banned in code AND UI — always qualified Org or Household.**

**Relationships (who-to-what):**

| Concept | Relationship | UI word | Code identifier | Model / table | Path |
|---|---|---|---|---|---|
| **Person** | the human | name / "person" | `participant` | `Participant` (sole person model) | — |
| **Org Membership (A)** | Person/household ↔ **Organization** | "Treehouse Member" | `isActiveOrgMember`, `orgMember…` | `OrgMembership` (rename from `Membership`) | `/api/shop/org-members` |
| **Household** | grouping | "household" (warm: "family") | `household` | `Household` | `/api/household` |
| **Household Membership (B)** | Person ↔ **Household** | "household member" | `householdMember` | `householdId` FK + `HouseholdLead` | `/api/household/member` |
| **Program relationship** | Person ↔ **Program** | "participant" | `programParticipant` | `ProgramParticipant` | — |

Key rules: **`participant` is reserved for the Person model/row and the Program relationship only** — never the household relationship (that's `householdMember`). The `/api/household/member` route **stays** (the `/household/` segment qualifies it). `participantProjection.ts` / `HOUSEHOLD_PEER_SELECT` project a Person row → keep `participant`.

**Person sub-classifications (orthogonal to the relationships):**

| Term | Exact meaning | Code identifier | User-facing copy |
|---|---|---|---|
| **Household lead** | Guardian (`HouseholdLead`). | `householdLead` | "Household lead" / "guardian" |
| **Youth** | Under 18 — **age** (`isMinor`→`isYouth`). Absorbs **minor** only. | **`youth` / `isYouth`** | "youth" |
| **Child** | The lead's **offspring / kin** — a **relationship**, age-independent (a 25yo is still a child). Distinct from youth and dependent. | **`child`** (relationship contexts) | "child" / "children" |
| **Student** | Pre-college **program enrollee** — NOT an age test. | `student` reserved for enrollment contexts only | "Student" only where truly enrollee |
| **Dependent** | Non-lead household member a lead acts for; broader than `child` (a non-lead adult non-offspring is a dependent, not a child). | non-lead subset of `householdMember`; `dependent` retired as loose synonym | "someone in your household" |

---

## 3. Semantic issues surfaced (fixed inside the Student & Participant phases)

**BUG-1 (real risk) — "student" is age-in-disguise, wired to a safety alert.**
`getFullAttendance.ts:45,49,60` `studentVisits = minors` → `unaccompaniedStudents`
powers the two-deep / unaccompanied-minor banner (`page.tsx:162`,
`attendance/current:406`). Same in `facility/trends` and `attendance/current`.
The rule is genuinely age-based; the identifiers lie by calling it "student".
Risk: whoever later honors the real "student = program enrollee" meaning and
edits `isStudent` breaks the minor-safety check + facility analytics. **Resolved
by the Student phase** (rename age-based `student`→`youth`, no logic change).

**NON-BUG (verified) — `/api/shop/members` `{ Participant: members }`.** The bag
key `Participant` (`route.ts:23`) is the **model name** driving field-tier
stripping (`security/handler.ts:104-122`); the wire key comes from
`envelope: 'members'` (`registry.ts:228`). Consumer reads `.members`
(`ToolManagementPanel.tsx:514`) — correct. Wire response really is `{ members: [...] }`.
Add a one-line comment; do not "fix".

**BUG-2 (found during Phase 1 followup) — membership intake's `children` bucket = every non-lead.**
`src/lib/membership/intake.ts:95-98` computes `const children = participants.filter(p => !leadIds.has(p.id))`
and exposes it as the `children` wire key on `GET /api/membership` prefill (`:131`)
and `POST /api/membership/intake` (`:304`). Given the corrected taxonomy
(`child` = offspring; `dependent` = any non-lead), this bucket is really the
**dependent / non-lead** set — it would sweep in a non-lead adult who isn't the
leads' offspring. So the name is *imprecise*, not an age bug. It is NOT a
`youth` concept — do not rename toward youth. **Resolve in the Dependent phase
(Phase 6):** either accept "children" (if the product treats every non-lead as
offspring) or rename the bucket + wire key to `householdParticipants`/`dependents`.
Lower severity than BUG-1.

**Checked, NOT found — hard `student/youth == non-lead` conflation in logic.**
Only in vocabulary (`dependent`≈non-lead, `student`≈minor). Promotion allows a
non-lead **adult** → lead (`my-household:416`). Behavior preserves the
distinction today; BUG-1 is what would tempt a future violation.

---

## 4. Phases — one term, fully, then the next

Each phase carries a single term across all four layers and leaves the tree with
no half-renamed state. **Recommended order is top-to-bottom**; rationale in §5.
Every phase ends with the existing test suites green (rename the fixtures/mocks
listed as part of the same phase).

---

### Phase 0 — the glossary (done)
Landed: [`docs/VOCABULARY.md`](../VOCABULARY.md) — the single canonical
definition of every people/household term, the code-vs-copy split, and the
"don't rename into these" list. It is the target each phase converges on.

- **Glossary upkeep is the orchestrator's job, not the phase chip's.** Phases
  run as isolated chips in fresh worktrees that won't have this uncommitted
  glossary in their tree — so a phase chip is NOT asked to edit `VOCABULARY.md`.
  Instead, whoever coordinates the phases flips that term's row from ⏳ to
  canonical once the phase merges. Keep the glossary and code in lockstep at the
  coordination layer.
- **Done-when:** file exists and matches §2 of this proposal. ✅

### Phase 1 — `youth` (absorbs `minor` ONLY — `child` stays)
**Goal:** one age word. `youth` is the age identifier; `isMinor`→`isYouth` the predicate; **`minor`** disappears from code and comments. **`child` is deliberately preserved** — it's a relationship term (offspring), not an age synonym (see §1b REVISED, §2).

**Status: landed as #670 (`minor`→`youth`) + a followup for comment scrub.**
- **Predicate:** `isMinor`→`isYouth` in `src/lib/time.ts:95` + the 7 consumers + tests. Body (`age < 18`) unchanged. ✅ (#670)
- **Identifiers:** `minor*` var/map → `youth*` (e.g. `getFullAttendance.ts` `minorMap`→`youthMap`; `studentVisits` is Phase 2). ✅ (#670)
- **Comments/prose:** the word "minor" → "youth" in comments + dev-seed strings (`api/programs/[id]/route.ts`, `api/events/[id]/route.ts`, `security/registry.ts`, `importDob.ts`, `seed-helpers.ts`, `participantProjection.ts`). ⏳ followup chip.
- **`child` — leave entirely alone.** Do NOT touch the join-flow `ChildForm`/`children`/`addChild` identifiers, and do NOT touch "Children"/"Add child" copy. `child` = offspring, a valid term. (An over-eager first followup renamed these to `youth`; that branch is discarded.)
- **Schema:** none — age derived from `dateOfBirth`; no `minor`/`child` column exists.
- **Done-when:** grep `\bminors?\b` in `src` (non-test) returns 0; `child` identifiers and copy remain intact.

### Phase 2 — `student` (fixes BUG-1; reserves the word)
**Goal:** age-based "student" becomes `youth`; `student` is freed to mean *program enrollee* only. Depends on Phase 1 (`youth` must exist).

- **Rename age→youth** everywhere `student` is `isMinor`-derived: `getFullAttendance.ts` (`studentVisits`→`youthVisits`, `unaccompaniedStudents`→`unaccompaniedYouth`, `counts.students`→`counts.youth`); `attendance/current/page.tsx` (`isStudent`→`isYouth`, `studentList`→`youthList`, "Students" column→"Youth", 🎓 label); `api/facility/trends/route.ts` (`isStudentAtDate`→`isYouthAtDate`, `uniqueStudents`→`uniqueYouth`, `studentHours`→`youthHours`); `facility-ops/trends/page.tsx:133` header; `types/attendance.ts:48` `students`→`youth`; `membership-ops/participants/new/page.tsx` (`studentSelected`→`isYouthSelected`, "Student Detected"→"Youth Detected", "Optional for Students"→"Optional for Youth"); `page.tsx:162` + `attendance/current:406` "unaccompanied student"→"unaccompanied youth".
- **Contract:** `types/attendance.ts` and the `facility/trends` JSON shape (`uniqueStudents`/`totalStudentHours`) are internal to our own UIs — rename shape + consumers in the same commit. No external client.
- **Schema:** none. (`ProgramParticipant` already models real enrollment; no `student` column.)
- **Reserve:** after this phase `student` appears in **zero** code. Reintroduce it *only* when §6 Q3 says a real enrollment-based "student" is a product concept — derived from `ProgramParticipant`, never from age.
- **Done-when:** grep `student` in `src` (non-test) returns nothing (or only a deliberate enrollment concept from Q3).

### Phase 3 — `householdMember` (retires sense-B bare `member`) — SHIPPED (#674)
**Goal:** any person in a household → `householdMember` (code) / "household member" (UI). The bare word `member` no longer names the household relationship.

- **Route STAYS `/api/household/member`** — the `/household/` segment already qualifies "member" as the household relationship. Do **NOT** move it to `/participant`. (`participant` is reserved for the Person model + Program relationship; see §2.)
- **Identifiers:** sense-B `member*` vars/types/params → `householdMember*` across `api/household/member/route.ts`, `my-household/page.tsx`, `api/events/mine/route.ts`, `api/programs/mine/route.ts`, `lib/membership/intake.ts`, `attendance/household`, `safety/emergency-contacts`, tests.
- **Kept intentionally:** `programParticipants` (Program relationship) and Prisma `participant`/`participantId` (Person row) — rule 2. `participantProjection.ts`/`HOUSEHOLD_PEER_SELECT` stay `participant`.
- **Copy:** sense-B "Member" JSX → "household member".
- **Schema:** none — the person model is already `Participant`; this is the word catching up.
- **Done-when:** no bare `member`/`Member` identifier or UI string resolves to the household relationship; all are `householdMember`/"household member". ✅ (#674, branch `claude/determined-bell-70bb18`)
- **Note:** an earlier spec of this phase (move route → `/api/household/participant`, rename to `participant`) was **backwards** — `participant` is the Program/Person word, not the household word. Superseded by #674; the `/participant` chip branch is discarded.

### Phase 4 — `OrgMembership` (real rename + schema migration)
**Goal:** the org-membership relationship gets its own qualified name everywhere; the bare word `member`/`Membership` for "belongs to the org" becomes **Org**-qualified. UI word: **"Treehouse Member"** (confirm — see §6 Q-Org). Not a mere audit — a schema migration with wide blast radius; **scope it before starting.**

- **Schema migration (DB wiped on deploy → no data care):** `model Membership` → `OrgMembership`; `MembershipProcess` → `OrgMembershipProcess` (confirm naming); then `npx prisma migrate dev`. Decide whether `membership-ops/*`, `boardAlerts`/renewal/review, and the `MembershipStatus` enum follow the `Org` prefix — big blast radius, list every table + call site first.
- **Read-model identifiers:** `isActiveMember`→`isActiveOrgMember`; `ACTIVE_MEMBER_PARTICIPANT_WHERE`/`ACTIVE_MEMBER_INCLUDE`/`participantRecordIsActiveMember` → `…OrgMember…` (`lib/membership.ts`).
- **Program price tiers:** `memberOnly`, `memberPriceCents`, `nonMemberPriceCents` (`schema.prisma:600,612,615,670,673`) → `orgMemberOnly`/`orgMemberPriceCents`/`nonOrgMemberPriceCents`. Confirm whether `shopify*VariantId` naming must follow.
- **Path:** `/api/shop/members` → `/api/shop/org-members` (consumers: `ToolManagementPanel.tsx:511`, registry `security/registry.ts:226`, strip + integration tests). Keep the bag-key(`Participant`)/envelope(`org-members`) convention; comment it.
- **UI copy:** "Member Price", "Member-Only"/"Member Only", "become a member", "isn't a member yet", shop-cert "Certified members" → "Treehouse Member" wording.
- **Done-when:** no bare `member`/`Membership` for the org relationship in code or UI; all are `orgMember…`/`OrgMembership`/"Treehouse Member".

### Phase 5 — `household` vs `family` (schema migration if unifying)
**Goal:** resolve the split. Two branches — pick via §6 Q2.

- **Branch A — keep the split (recommended default, no migration):** document "code = `Household`, user-facing = 'family' where warmth helps". Leave `familyContext`, "Volunteer-only family", "Family Information". Add a short note in this doc / a code comment near `Household`. Done.
- **Branch B — unify to Household everywhere (full, includes schema):**
  - **Schema migration:** rename field `TrustedAdult.familyContext`→`householdContext` in `schema.prisma:476`, then `npx prisma migrate dev`. DB is wiped on deploy — don't care whether Prisma emits `RENAME COLUMN` or drop+recreate; just land the right final shape.
  - **Consumers to move in the same PR:** `api/safety/trusted-adults/route.ts:25`, `api/trusted-adults/route.ts:21,38,73`, `api/trusted-adults/mine/route.ts:24`, `api/trusted-adults/operational/route.ts:10`, `safety/trusted-adults/page.tsx:49,188`, plus the security registry field lists / strip tests referencing `familyContext`.
  - **Copy:** "family"→"household" in `my-household:353`, `membership-ops/review:137`, `programs/[id]/register:199`, `volunteer-memberships:71`, `membership-ops/participants:278`, `my-activities/*`; internal `memberFamilies`→`memberHouseholds` (`membership-ops/layout.tsx`, `api/nav/todo-counts/route.ts`).
- **Done-when:** either the split is documented (A) or "family" appears nowhere and the migration is applied (B).

### Phase 6 — `dependent` (retire the word; optional JSON backfill)
**Goal:** "dependent" stops being UI jargon; it resolves to "household member/participant" (non-lead). Lowest ROI, so last.

- **Intake `children` bucket (BUG-2):** `lib/membership/intake.ts` names its non-lead-participant set `children` and exposes it as the `children` wire key on `GET /api/membership` (`:131`) and `POST /api/membership/intake` (`:304`), consumed by `membership/page.tsx` (`prefill.children`, `buildPayload().children`). DB is wiped on deploy and there's no external client, so rename the key + type (`ChildInput`→`HouseholdParticipantInput`, `children`→`householdParticipants` or `dependents`) across server + client + `page.tsx` in one commit. This is a non-lead concept — do NOT rename it to `youth`.
- **Copy + comments:** `communication/page.tsx:11` label → "Email me when someone in my household checks in/out"; `my-household/page.tsx:443`, `membership-ops/participants/import/page.tsx:138`, `trusted-adults/page.tsx:12`, `pageRegistry.ts:26,66`, `api/programs/[id]/participants/route.ts:64` comment, `lib/notifications.ts:86` doc → "household member". Test comment `notificationsCheckin…:61`.
- **Persisted key:** `emailDependentCheckins` is a **key inside the `notificationSettings` JSON blob** (`Participant.notificationSettings`, `schema.prisma:92`), not a column. DB is wiped on deploy, so **no backfill** — just rename the key to `emailHouseholdCheckins` in the readers/writers and old rows vanish with the reset:
  - `lib/notifications.ts:86,150`, `communication/page.tsx:11,27,41`, tests `notificationsCheckin.integration.test.ts:43,61` + `.perf.test.ts:28`.
  - No Prisma migration needed (JSON blob has no key-level schema).
- **Done-when:** "dependent" appears in no user-facing copy and no live identifier; the JSON key reads `emailHouseholdCheckins`.

---

## 5. Order & rationale

1. **Youth** — establishes the age canon (`isYouth`); low risk, no schema. **Shipped (#670).**
3. **householdMember** — biggest everyday confusion (sense-B "member"); no schema (person model already `Participant`). **Shipped (#674).**
2. **Student** — **fixes BUG-1** (the only correctness trap). Must follow Youth. No schema. *Next.*
4. **OrgMembership** — real schema migration (`Membership`→`OrgMembership`) + path + price fields + UI to "Treehouse Member". **Wide blast radius — scope before starting** (see §6 Q-Org).
5. **Household/Family** — product decision + a trivial column rename (Branch B; DB wiped, no data care). §6 Q2.
6. **Dependent** — lowest ROI; key/copy rename + the BUG-2 intake `children` bucket, no migration (DB reset).

Correctness (Student/BUG-1) is the priority remaining item. Phases 1 & 3 already
landed. Phase 4 is the heaviest (schema) — do it deliberately, not as a sweep.

---

## 6. Open questions for the human (gate specific phases)

1. **[RESOLVED] `child` vs `youth`.** `child` = the lead's offspring (relationship, any age); `youth` = under-18 (age). They are different concepts, so `child` stays a valid identifier + copy wherever it means offspring, and `youth` is used only for the age sense. Only `minor` folds into `youth`.
2. **[gates Phase 5 branch] Unify household/family, or bless the split?** Default: keep the split (Branch A, no migration) — `Household` in code, "family" in warm user copy. Say "unify" to trigger Branch B (schema migration of `familyContext`).
3. **[gates Phase 2 reservation] Does a real, age-independent `student` (program enrollee) exist as a product concept to surface?** If yes, it gets its own `ProgramParticipant`-derived derivation *after* Phase 2 lands. If no, "student" is retired entirely in favor of "youth" + "enrolled participant".
4. **[Phase 6] `emailDependentCheckins` key** — DB is wiped on deploy so there's no backfill cost; default is to rename it to `emailHouseholdCheckins` along with the copy. Say so if you'd rather leave the private key as-is.
5. **[gates Phase 4 / Q-Org] Org-member UI term.** Locked to **"Treehouse Member"** everywhere, or context-dependent (e.g. "Org Member" for dense staff tables)? Confirm a single term or the split.
6. **[gates Phase 4 scope] OrgMembership blast radius.** Does the `Org` prefix propagate to `MembershipProcess`, `MembershipStatus`, all of `membership-ops/*`, and boardAlerts/renewal/review? Scope the full table + call-site list before starting.
7. **[confirm] `participantProjection.ts` / `HOUSEHOLD_PEER_SELECT`** project a **Person row** (`participant` = Person), so they stay `participant` — confirming so no later sweep renames them.
</content>
