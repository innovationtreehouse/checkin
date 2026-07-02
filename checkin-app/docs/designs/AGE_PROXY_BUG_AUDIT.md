# Age/Proxy Mislabel Audit

**Status:** investigation only — no code changed. Companion to the trends fix
(a chip already in flight) and to `PERSON_UMBRELLA_INVESTIGATION.md`.

## The bug class

A metric, label, or decision is computed from a **cheap proxy** — usually
**age** (`dateOfBirth` → `isYouth`/`calculateAge < 18`), sometimes a **role
boolean** (`isKeyholder`) — when the real intent is a **relationship, enrollment,
or role** (`ProgramParticipant`, `ProgramVolunteer`, `HouseholdLead`). Proxy and
concept agree most of the time, then diverge on the edge cases and silently
produce wrong data or a wrong label:

- a **30-yo enrolled participant** counts as a "volunteer" (not <18),
- an **11-yo who never enrolled** counts as a "student"/"participant" (is <18),
- an **adult parent who never volunteered** counts as a "volunteer" (adult,
  not a keyholder).

The trends route (`api/facility/trends`) is the flagship: it split visit-hours
"participant vs volunteer" purely on age. This audit sweeps the rest of the
codebase for the same shape and tiers each hit by whether the **data** is wrong
(a real bug) or only the **word** is wrong (a rename).

Method: grepped every non-test use of `calculateAge`/`isYouth`/`isMinor`/`< 18`/
`eighteenYears` and every `volunteer` derivation not sourced from
`ProgramVolunteer`.

---

## Tier A — real logic/semantics bug (proxy ≠ intent; the *number* is wrong)

| # | Site | Proxy used | Real intent | Status |
|---|---|---|---|---|
| A1 | `api/facility/trends/route.ts:9-11,143,176-177` (`isStudentAtDate`) | age < 18 → "student"; else "volunteer" | enrollee hours (`ProgramParticipant`) vs volunteer hours | **known — fix chip in flight** |
| A2 | `lib/getFullAttendance.ts:50,54` (`volunteerVisits`, `counts.volunteers`) + `attendance/current/page.tsx:75,81` (`volunteerList`, `householdVolunteers`) | `!isKeyholder && !isYouth` → "volunteer" | if the intent is *real volunteers*, that is `ProgramVolunteer`; the proxy is "adult non-keyholder" | **WON'T CHANGE** (decided after investigation — see below) |

**A2 detail.** The "volunteer" bucket on the live attendance dashboard is *every
adult who isn't a keyholder* — it sweeps in enrolled adult participants, parents,
and board members, none of whom are necessarily `ProgramVolunteer`. Same shape as
the trends bug, on the volunteer side.

> **RESOLUTION — WON'T CHANGE.** Investigated under a dedicated chip
> (`ATTENDANCE_VOLUNTEER_PROXY_PROPOSAL.md`); closed as won't-change. Unlike the
> trends metric (A1), the attendance dashboard's "adult non-keyholder" count is
> the *intended* number — an "adults on the floor" supervision signal — and the
> UI already labels it honestly as **"Volunteers/Adults"**. The age/keyholder
> split is also safety-load-bearing (two-deep banner), so it stays as-is. Not a
> real-volunteer count and not meant to be one. No change.

Three things keep A2 lower-severity than A1:
1. The UI already partly admits it: the column renders **"Volunteers/Adults"**
   (`attendance/current/page.tsx:418`), not "Volunteers".
2. It's a live-view count, not a persisted/exported metric.
3. **The age/keyholder split is load-bearing for safety** — `adultVisits`
   (`getFullAttendance.ts:59`) and the two-deep / unaccompanied-youth banner
   (`:60-67`) depend on "adult" = `!isYouth`. **Do NOT rename the logic into an
   enrollment check.** Only the *volunteer* label is the proxy problem; the
   *adult/youth* split under it is genuinely age (Tier C).

**Residual after the trends fix (worth noting):** once trends computes
"participant = ACTIVE `ProgramParticipant`", its *volunteer* bucket becomes
"everyone not an active participant" — staff, real volunteers, unenrolled adults,
unenrolled minors all lumped together. The participant side gets rigorous; the
volunteer side stays a catch-all complement. If a true "volunteer hours" number
is ever wanted, derive it from `ProgramVolunteer`, don't leave it as the negative
space of participant.

---

## Tier B — wording only (age *is* the concept; the label just says "student")

Logic is age-correct; the word "student" should be "youth" (proposal Phase 2).
No data bug. Listed so the rename sweep catches them and nobody "fixes" them into
an enrollment check.

| # | Site | What it does | Note |
|---|---|---|---|
| B1 | `attendance/current/page.tsx:40,82,419` (`isStudent`, `householdStudents`, 🎓 "Students") | age < 18 → "Students" column | genuinely youth for unaccompanied-minor safety; **out of scope** per the trends chip — rename word only |
| B2 | `membership-ops/participants/new/page.tsx:40,146,154,161` (`studentSelected = isYouth(dob)`, "Student Detected", "Optional for Students") | youth → require a guardian/parent email, own email optional | the *logic* (minor needs a guardian) is age-correct; only the word "student" is wrong |
| B3 | `components/DevLoginPicker.tsx:61` (`Student (age)` badge) | age < 18 → "Student" badge | dev tooling only; cosmetic |

---

## Tier C — genuinely age, correct (no action; do not "enrollment-ify" these)

These read as age *because age is the actual concept* (legal minor, guardian
requirement, age eligibility). Flagging them so a future sweep doesn't mistake
them for the bug class.

| Site | Correct age use |
|---|---|
| `api/profile/route.ts:35`, `profile/page.tsx:87` | youth profiles are read-only (age) |
| `api/profile/onboarding-status/route.ts:28` | adults need a phone; youth don't (age) |
| `my-household/page.tsx:39-40,383,399` | age badge / "Adult" vs "Age (n)" (age) |
| `api/membership-ops/participants/import/route.ts:70`, `import/preview/route.ts:143` | minor without a parent email → needs guardian (age) |
| `programs/[id]/page.tsx:338`, `program-ops/programs/[id]/page.tsx:485`, `api/programs/[id]/participants/route.ts`, `public-register/route.ts:112` | program `minAge`/`maxAge` eligibility (`schema.prisma:602,604`) — genuine age gate |
| `api/roles/route.ts:28`, `settings/roles/page.tsx:97`, `api/participants/search` (`eighteenYearsAgo`) | expose/filter a youth flag (age) |
| `membership-audit/broken/page.tsx:77,81` | youth badge (age) |
| `lib/dev/zoho-import.ts:276` | import: primary < 18 handling (age) |

---

## Related, already-catalogued proxy mislabels (different proxy, same family)

From `PARTICIPANT_TERMINOLOGY_PROPOSAL.md` §3 — same "proxy ≠ concept" family,
already tracked:

- **BUG-2** — `lib/membership/intake.ts:95` `children` bucket = *every non-lead*
  (proxy: `!isLead` → "children"). Real concept: dependents/household
  participants, not offspring. Proposal Phase 6.
- The proposal's **BUG-1** is exactly the trends/attendance "student = age" word
  problem (Tier B here), with the standing warning: renaming `student`→`youth`
  must not disturb the safety logic underneath (Tier A2 caveat).

---

## Recommendations

1. **A1 (trends):** covered by the in-flight chip — enrollment-based split. ✅
2. **A2 (attendance "volunteer"):** investigated, **closed WON'T CHANGE** — the
   "adult non-keyholder" count is the intended supervision signal (already
   labelled "Volunteers/Adults"), and its age/keyholder split is safety
   load-bearing. No change. See `ATTENDANCE_VOLUNTEER_PROXY_PROPOSAL.md`.
3. **Tier B:** fold into the student→youth rename (Phase 2). Word-only.
4. **Tier C:** leave alone.
5. **Doc:** the team likely wants to record a new **BUG (trends measured age, not
   enrollment)** in `PARTICIPANT_TERMINOLOGY_PROPOSAL.md §3`. Not edited here (the
   proposal is read-only from this chip).

**Net:** across the whole codebase, the age-as-proxy-for-enrollment/role bug had
two candidates — `facility/trends` (A1, fixed) and the attendance "volunteer"
bucket (A2, investigated and **closed won't-change**: intended supervision count,
safety-guarded). Only A1 was a real defect. Everything else is either a pure
wording issue (Tier B) or a legitimate age concept (Tier C).
