# "My Programs" — Program-Staff Home: Scoping Document

**Status:** MVP shipped — `/my-programs/` (landing + attendance + conflicts) and the `lead` bucket in `/api/nav/todo-counts`. This is the scoping record: interview decisions, the recommended structure, and the post-MVP roadmap / open questions below.
**Date:** 2026-06-28
**Purpose:** Give a program lead mentor (and, later, lesser staff roles) a navigation home and an in-app pending-work surface. Before this, they had responsibility but no home: `/program-ops` is gated to board, `/my-activities` is the attendee view.

---

## 1. Current State (what is true today)

### The gap
Three program audiences, two homes:
- `/my-activities` — any signed-in user; programs/events they **attend** (member side).
- `/program-ops` — gated `sysadmin || boardMember`; manage **all** programs (board side).
- **Program staff** (lead mentor / core volunteer who *runs* a program but isn't board) — **no home**.

### Key finding: the capability already exists; only the surface is missing
This reframes the whole effort. The backend already recognizes a lead mentor and grants per-program powers. It is **not** a permissions build — it is a **navigation + surfacing** build.

- `prisma/schema.prisma` (~L523–567): `Program.leadMentorId: Int?` → `leadMentor` relation `"ProgramLeadMentor"`; `volunteers: ProgramVolunteer[]` (many-to-many, `isCore: Boolean`); `participants: ProgramParticipant[]` (status `PENDING|ENROLLED|DROPPED|COMPLETED`, `paymentPlanRequested`).
- `checkin-app/src/security/access-resolvers.ts` (L55–62, 183–213, 301–352): builds `CallerContext.programsLed: Set<number>` from `leadMentorId === auth.user.id`; route role `'program-lead-mentor'` and row scope `'their_program_participants'` already exist for Program/Event/RSVP/ProgramVolunteer/Fee.
- Per-program API routes already let a lead act on **their** program: edit program (`/api/programs/[id]`, lead cannot reassign `leadMentorId`), settings, volunteers add/remove/promote, create events, eligible-participants, publish, confirm attendance (`/api/events/[id]`). Admin always overrides.
- Manage UI already gates to the lead: `/app/admin/programs/[id]/page.tsx` L308 `isAuthorized = leadMentorId === user?.id || sysadmin || boardMember`.

So a lead **can already do** roster/event/volunteer/attendance work — they just have to be handed a deep link (today, the G2 email) to find it.

### Existing surfaces
- **Nav** (`checkin-app/src/components/AppFrame.tsx` L60–116, `NAV_ITEMS`): each item has a `visible(user, signedIn)` predicate. Badges via `navBadgeFor()` (L128) off `useTodoCounts`. Green badge = action you must take; gray = informational count.
- **`/my-activities`** (`src/app/my-activities/`): attendee tabs "My Events" (`/api/events/mine`) + "My Programs" — the latter is a **stub** (enrolled-as-participant, *not* run-as-staff). Note the name collision with this project.
- **`/program-ops`** (`src/app/program-ops/layout.tsx`): `useRequireRole(["sysadmin","boardMember"])`; sub-nav All Programs / New Program / Events.
- **`/api/nav/todo-counts/route.ts`** (`TodoCounts`): `member.{household[], programs[]}` itemized; `building`, `activePrograms` informational; optional `admin.{membership, programsPending, trustedAdults}` numeric. **No lead-mentor bucket exists.**
- **Session user** (`types/next-auth.d.ts`): `sysadmin, boardMember, keyholder, backgroundCheckReviewer, householdLead, toolStatuses[]`. **No "mentor" role** — lead status is computed per-request from `leadMentorId`.

### G2 — the post-event attendance email (the thing being folded in)
`src/lib/postEventEmails.ts`: `processPostEventEmails()` fires ~1h after an event where `programId != null`, `postEventEmailSent=false`, `attendanceConfirmedAt=null`. Targets `program.leadMentorId` (fallback: first core volunteer). Subject "Action Required: Confirm Attendance…", links `/admin/events/{id}` where the lead clicks "Confirm Attendance" (gated `leadMentorId === userId`). **This is currently the lead's only touchpoint.** The MVP surfaces this same pending item in-app.

---

## 2. Interview Findings (by theme)

### Core purpose — broad, all four named
Lead wants the section to be: a **pending-work inbox**, a **management home**, a **roster + attendance hub**, and (later) **comms with families**. North star is a full program-running home; MVP is a thin slice (below).

### Audience & roles
- **MVP audience: lead mentor only** (`leadMentorId`). Core volunteers stay email-only for now.
- **New role coming: "assistant lead"** — explicitly *less* than a co-lead. Power line:
  - **Can:** take/confirm attendance, view roster, **alter a meeting date or add a meeting**.
  - **Cannot:** edit program settings/pricing, assign volunteers, make enrollment decisions.
  - **Deferred** — do not design these permissions now; just don't architect them out.
- Co-lead (multiple full leads on one program) is **not** wanted; assistant-lead is the tiered second person instead. (Schema today has a single `leadMentorId`.)

### Multi-program
- **Yes** — one person may lead **multiple** programs. The section must list all of them, show each on its own, **and** show all-programs-visible at once. Tabs for detailed views (e.g. an attendance table) balanced against a per-program / all-programs overview.

### Boundaries — the governing rule
Two hard rules stated by the user, both pointing the same way:
1. **No new capability.** MVP exposes nothing a lead can't already do. Enrollment **approval stays board-only** (lead may view, not decide) — not because of a new restriction but because we won't build new power.
2. **No new info exposed.** Leads already have some participant/family PII (emergency contacts, etc.). Surface only what they already have access to — don't widen PII.

Plus:
- **No other programs** — a lead sees only programs they lead, never the board's full roster of all programs.
- **No finance** — no payment-plan approvals, pricing, or revenue. Money stays board-only (`admin.programsPending` remains an admin bucket).

### Comms with families
**Later / nice-to-have.** No messaging exists in the backend; do not let it shape the MVP structure. (When built: likely a contact-list-first step before any in-app messaging.)

### Pending-work surface
- **Nav badge** (green count on "My Programs", like household todos) = items needing the lead's action.
- **Landing balances** an all-programs overview with per-program drill-down; detailed things (attendance table) live in tabs.
- **Keep the G2 email** — in-app is **additive**, email keeps firing as backup, not replaced.
- Beyond attendance (post-MVP): **upcoming sessions and RSVPs shown together**; enrollment requests view-only.

### Naming & horizon
- **"My Programs" is the right name.** (Caveat: collides with the existing attendee "My Programs" tab in `/my-activities` — see Open Questions.)

---

## 3. Envisioned Future-State Model

```
Attendee (any signed-in)        Staff (leads ≥1 program)         Board (sysadmin||boardMember)
  /my-activities         <-->     /my-programs  (NEW)      <-->     /program-ops
  events I attend                 programs I run                    all programs, finance,
  programs I'm enrolled in        roster, attendance, sessions      enrollment approval, pricing
```

- **Roles:** `lead mentor` (today) → add `assistant lead` (deferred, tiered-down). No co-lead. Mentor status stays computed from `leadMentorId` / `programsLed`; assistant-lead will need a new per-program association when built.
- **Scale direction:** more programs per person, more programs overall. Structure should make "all my programs" a first-class list so adding programs doesn't re-architect anything. Coordinators-over-categories was *not* affirmed as direction — don't build grouping yet.
- **Finance/enrollment-decision stay board-side** indefinitely under the no-new-capability rule.

---

## 4. Recommended Structure

**Sibling top-level nav item** (user's explicit choice), not a tab under My Activities and not a role-scoped `/program-ops`.

- **Route:** new `/my-programs` section, peer of `/my-activities` and `/program-ops`.
- **Nav gating** (`AppFrame.tsx` `NAV_ITEMS`): `visible: (u) => programsLed.length > 0` (or admin). The session/todo-counts payload must expose whether the caller leads ≥1 program — see "Plumbing" below. Board members who also lead a program see both nav items; that's fine.
- **Landing:** all-programs overview (one card per led program, each with its own pending-count badge) → click into a per-program view with **tabs** (Overview / Attendance / Sessions). Reuse the existing `/admin/programs/[id]` and `/admin/events/[id]` screens — deep-link, don't rebuild.
- **Pending surface:** green nav badge (sum of items across led programs) + per-program card badges. Landing's "needs attention" list deep-links to the existing confirm-attendance screen.
- **Boundaries enforced by reuse:** because the section only links to routes already gated by `programsLed`, the "no other programs / no new capability / no new PII" rules hold for free. No finance routes are linked.

**Why sibling beats the alternatives:**
- *Tab under My Activities* — conflates "I attend" with "I run"; the existing stubbed "My Programs" tab is attendee-enrollment, a different thing. Confusing.
- *Scaled /program-ops* — risks leaking board-only screens (finance, all-programs) behind one role flag; higher blast radius for the no-finance / no-other-programs rules.

---

## 5. MVP vs Full

### MVP (first slice worth shipping) — "Nav + attendance inbox"
1. New gated **sibling nav item** "My Programs", visible to anyone leading ≥1 program.
2. **Plumbing:** add a lead-mentor signal to the nav payload — extend `/api/nav/todo-counts` with a `lead` bucket (itemized, like `member`): pending attendance-to-confirm across the caller's led programs (events with `attendanceConfirmedAt = null`, ended, in a program they lead). Drives the green nav badge via `navBadgeFor()`.
3. **Landing page:** list of led programs; each shows pending attendance items; each item deep-links to the existing `/admin/events/{id}` confirm-attendance screen.
4. **G2 folds in:** the in-app list mirrors the post-event email's targets. **Email keeps firing** (additive). Same `leadMentorId`-gated confirm action; no new endpoint.

MVP exposes **no new capability and no new data** — it is pure navigation + surfacing of work the lead can already do. (Ponytail-clean: reuse `programsLed`, reuse confirm screens, one new todo bucket + one new section shell.)

### Next (post-MVP, affirmed direction)
- **Upcoming sessions + RSVPs shown together** per program.
- Per-program **roster** view (read using existing access).
- **Enrollment requests** surfaced **view-only** (PENDING participants); approval stays board.
- Multi-program polish: all-programs overview ↔ per-program tabs.

### Full / north star
- Full program-running home: roster + attendance + sessions + enrollment visibility + **comms with families** (contact-list first, messaging later).
- **Assistant-lead role**: new per-program association; powers = attendance/roster + add/move meetings; *not* settings/pricing/volunteers/enrollment.

### Explicitly out of scope (rules, not just "later")
- Finance (payment plans, pricing, revenue) — board-only, permanently.
- Enrollment **decisions** — board-only.
- Seeing **other** programs.
- Any **new** PII beyond what leads already access.

---

## 6. Open Questions (unresolved)

1. **Name collision:** `/my-activities` already has a "My Programs" tab (attendee enrollment). A sibling nav item also called "My Programs" will confuse. Rename one? (e.g. staff section "My Programs", attendee tab "Enrolled"/"Programs I'm In".) — user confirmed the *staff* name; the *attendee* tab rename is open.
2. **Lead-mentor signal in session vs per-request:** today `programsLed` is computed per-request. Nav gating needs it cheaply on every page. Add `leadsPrograms: boolean` (or count) to the session token, or piggyback on the `todo-counts` fetch the nav already does? (Leaning: todo-counts, since the badge needs it anyway.)
3. **Core volunteers:** MVP is lead-only, but G2 email already falls back to a core volunteer when there's no lead. Should the section be visible to core volunteers of a lead-less program at MVP, or stay strictly lead-only and accept the email-only gap?
4. **Assistant-lead data model:** when built, is it a new boolean on `ProgramVolunteer` (e.g. `isAssistantLead`) or a new field? Affects whether `programsLed`/access-resolvers extend cleanly. Deferred but flagged.
5. **Badge semantics:** green (action) is right for attendance-to-confirm. When upcoming-sessions/RSVPs join, are those gray (informational) so the green count stays "must act"? (Recommend: yes, mirror the existing green/gray split in `navBadgeFor`.)

---

## 7. Hand-off Notes for Implementation

- **Touch points:** `AppFrame.tsx` `NAV_ITEMS` + `navBadgeFor` (new item + badge); `/api/nav/todo-counts/route.ts` (new `lead` bucket); new `src/app/my-programs/` section (layout + landing); reuse `/admin/programs/[id]` and `/admin/events/[id]`.
- **Reuse, don't rebuild:** `CallerContext.programsLed`, `'program-lead-mentor'` route role, `'their_program_participants'` scope already exist in `access-resolvers.ts`. The confirm-attendance action already exists and is correctly gated.
- **Guardrails:** never link a finance or all-programs route into this section; that's the structural guarantee for the no-finance / no-other-programs rules.
- **G2:** do not remove the email. The in-app list and the email target the same `leadMentorId` and the same confirm screen; they coexist.
