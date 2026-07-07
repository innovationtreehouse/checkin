# Time-scoped emergency-contact access for program leaders

**Status:** Implemented (this PR). Working name: **Lead EC access**.
**Date:** 2026-07-07

## Problem

A program lead mentor needs a family's emergency contacts to do their job — but
only while the program is actually running, and only for the families in *their*
program. Today a lead can pull emergency contacts for any household with a child
in any program they lead, at any time, through the program-manage roster
(`GET /api/programs/[id]`, which grants leads `their_program_households:personal`
on `EmergencyContact`). There is no time limit and no record that the access
happened.

Product decision (interview): give leads a **dedicated, time-scoped, audited**
surface for emergency contacts, so access is bounded to the program's active
window and every view leaves a trail.

## Decisions (with rationale)

### D1 — Access is scoped to *the program's dates + a buffer*
A lead may view a program's emergency contacts only while `now` is within
`[startAt − BUFFER, endAt + BUFFER]`. The buffer covers the ramp-up before the
first session and the wind-down after the last (a parent who needs a call the
week after camp ends).

`BUFFER = LEAD_EC_ACCESS_BUFFER_DAYS = 7` days each side. This is a **constant**
(`src/lib/emergencyContacts/leadAccess.ts`), not configuration — the policy is a
fixed product decision, not an operator knob, so it lives in code where it is
reviewed, not in `BoardSettings`.

### D2 — Null dates fail CLOSED
If either `startAt` or `endAt` is null, no window can be computed, so lead access
is **denied** (403). A program with no schedule is not "running", and we never
default an unbounded window open. Board/sysadmin still reach the contacts through
their existing route (D4).

### D3 — Off-roster and out-of-window return a clean 403
- **Off-roster** (caller is not the program's `leadMentorId`): 403 — this is the
  lead surface; board/sysadmin use their own route.
- **Out-of-window / null dates**: 403 with a message that *explains the
  time-scoping* (names the program's dates and the ±7-day rule), so a lead who
  hits it understands why and what to do instead (ask a board member).

### D4 — Board/sysadmin are untouched
`GET /api/safety/emergency-contacts` (sysadmin/board/keyholder) keeps its current
behavior and its current logging. This feature adds **no** audit noise there — the
read-access trail is specifically for *lead* access, which is the newly-granted,
time-bounded capability worth recording.

### D5 — Every lead view is audit-logged, once per household (not per contact)
Each successful view writes **one `AuditLog` row per household** whose contacts
were returned: `action = READ`, `tableName = "EmergencyContact"`,
`affectedEntityId = householdId`, `secondaryAffectedEntity = programId`,
`actorId = the lead`. Riding the existing `AuditLog` (per the brief) means the
one schema change is a new `READ` value on the `AuditAction` enum — there was no
existing action that honestly represents a read. Granularity is per-household
("who saw this family's contacts") — a per-contact row would be noise, and
per-whole-request would lose which family was viewed.

### D6 — New scoped route, not an extension of `/api/programs/[id]`
This ships as a **new route** under `/api/my-programs/`, not as an authz change to
the existing program-manage roster. Why:
- A dedicated endpoint can return the **clean 403 with a time-scoping message**
  that D3 requires; the manage roster returns a whole program object and could
  only silently omit contacts.
- The time-window + per-household audit are the endpoint's whole purpose;
  bolting them onto the shared `their_program_households:personal` scope in the
  CODEOWNERS-gated boundary layer would time-scope *unrelated* consumers of that
  scope (e.g. `GET /api/trusted-adults/operational`) and would have to ship as a
  separate boundary-isolation PR (`security-boundary-isolation.yml`).
- It keeps this PR a single, reviewable feature with **no `src/security/**`
  boundary change.

**Known related surface (deliberately deferred):** the existing
`GET /api/programs/[id]` manage roster still exposes a lead's program households'
emergency contacts *without* a time window (unchanged here). Tightening that path
to route all lead EC access through this window is a follow-up **boundary PR**
(it edits registry grants / scope bindings) and is out of scope for this feature
diff. This route is the sanctioned time-scoped + audited surface the product
decision calls for; the manage-roster tightening is tracked as its own change.

### D7 — Lead only (not core volunteers)
The decision names the **program lead mentor**. Core volunteers are not granted
this surface (they can still be added later). The gate is `leadMentorId === caller`.

## Data model

No new tables or columns. One enum value:

```
enum AuditAction { CREATE  EDIT  DELETE  BECOME_ADMIN  READ }   // + READ
```

Migration `20260709030000_lead_ec_access` is a single additive
`ALTER TYPE "AuditAction" ADD VALUE 'READ'` (expand-only; the value is not
referenced in the same migration, so `ADD VALUE` is safe — same pattern as
`20260706070000_membership_application_archive`).

## Flow

`GET /api/my-programs/programs/[programId]/emergency-contacts` (withAuth, session
required; explicit response shaping — the strict idiom, no scope-stripper reliance):

1. Load the program (`id, name, leadMentorId, startAt, endAt`, and its
   participants' `person → {id, name, householdId}`). 404 if missing.
2. **Off-roster gate:** `leadMentorId !== caller` → 403.
3. **Window gate:** `isWithinLeadAccessWindow(now, startAt, endAt)` false → 403
   with the time-scoping message. Null dates return false (D2).
4. Derive the distinct households of the program's participants; load each
   household's **valid** emergency contacts (`conflictParticipantId = null`, name
   and phone present), selecting only `{id, name, phone, email, relationship}` —
   no internal fields (`phoneDigits`, `conflictParticipantId`, timestamps) ever
   leave.
5. **Audit:** one `READ`/`EmergencyContact` row per household (D5).
6. Return `{ program, households: [{ householdId, householdName, participants[],
   contacts[] }] }`.

**UI:** a "Contacts" subtab on `/my-programs`. It lists the programs the caller
leads (from the `todo-counts` `lead` bucket already fetched by the nav); picking
one calls the route. In-window → the households + contacts render; out-of-window
or null-dates → the API's 403 message is shown inline as the time-scoping
explanation. (Sibling work on `feat/my-programs-info` is extending the roster
views; this tab is self-contained and only reads the new endpoint.)

## Prod-safety

- **Additive migration**, expand-only; no columns/data touched; `ADD VALUE` is
  not referenced in-migration (safe). No contract step.
- **No boundary change** (`src/security/**` untouched) → no
  `security-boundary-isolation.yml` violation; single feature PR.
- **routeAuthDrift:** the GET reads `Program.participants` (ProgramParticipant is
  an edge-sensitive model), so the route is registered in
  `EDGE_INCLUDE_ALLOWLIST` with a justification (admission-gated to the lead +
  query-shaped to their in-window roster households).
- Fail-closed on null dates; explicit field selection (defense in depth over the
  `EmergencyContact` fail-closed scope binding, which still strips these rows for
  any non-lead caller).

## Deliberately deferred

- Tightening `GET /api/programs/[id]`'s lead EC exposure to the same window (own
  boundary PR — D6).
- Core-volunteer access (D7).
- Making the buffer or the window per-program configurable (it's a constant by
  decision — D1).
- Auditing board/sysadmin reads on `/api/safety/emergency-contacts` (D4).
