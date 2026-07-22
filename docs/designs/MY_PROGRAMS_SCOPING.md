# "My Programs" — program-staff home: scoping record

**Status: SHIPPED (MVP).** `src/app/my-programs/` (landing redirects to an
Attendance tab; a Conflicts subtab for duplicate/overlapping visits also
shipped) + a `lead` bucket in `/api/nav/todo-counts`. Nav item gated on
`leadsAnyProgram(counts)` in `AppFrame.tsx`. This is the interview/decision
record.

## The reframe that shaped everything

This was **not** a permissions build — the backend already recognizes a lead
mentor and grants per-program powers (`Program.leadMentorId`,
`CallerContext.programsLed`, the `'program-lead-mentor'` route role and
`'their_program_participants'` row scope in `src/security/access-resolvers.ts`).
A lead could already do roster/event/volunteer/attendance work; they just had to
be handed a deep link (the post-event "G2" attendance email) to find it. So this
is a **navigation + surfacing** build over existing gates.

## Interview decisions (the code-independent choices)

**Audience: lead mentor only for MVP** (`leadMentorId`). Core volunteers stay
email-only for now — a known, accepted gap (a lead-less program's core volunteer
gets the G2 email but no in-app surface).

**Governing boundary rules — permanent, not "later":**
- **No new capability.** MVP exposes nothing a lead can't already do. Enrollment
  **approval stays board-only** (lead may view, not decide).
- **No new PII.** Surface only what leads already access; don't widen it.
- **No other programs** — a lead sees only programs they lead.
- **No finance** — payment plans, pricing, revenue stay board-only.

These hold *structurally by reuse*: because the section only links to routes
already gated by `programsLed`, and never links a finance or all-programs route,
the rules can't be violated without adding such a link. That is the guardrail.

**Sibling top-level nav item** (not a tab under `/my-activities`, not a
role-scaled `/program-ops`). *Why:* a tab conflates "I attend" with "I run"; a
scaled `/program-ops` risks leaking board-only screens (finance, all-programs)
behind one flag — higher blast radius for the no-finance / no-other-programs
rules.

**Keep the G2 post-event email.** The in-app pending list is **additive** — same
`leadMentorId`-gated confirm screen, email keeps firing as backup.

**Multi-program is first-class.** One person may lead many programs; "all my
programs" must be a first-class list so adding programs re-architects nothing.

**A tiered "assistant lead" role is coming, deliberately deferred.** Powers when
built: attendance/roster + add/move a meeting; **not** settings/pricing/
volunteers/enrollment decisions. No co-lead (multiple full leads) — assistant is
the tiered second person instead. Don't design the permissions now, but don't
architect them out (today's schema has a single `leadMentorId`).

## Still open / not yet built (verified against the tree)

- **Post-MVP roadmap, unbuilt:** per-program roster view, upcoming sessions +
  RSVPs together, enrollment requests surfaced **view-only** (PENDING
  participants; approval stays board), all-programs↔per-program tabs. The layout
  ships only Attendance + Conflicts today.
- **Attendee-tab name collision (open):** `/my-activities/programs` is still
  titled "My Programs" too. The staff name was confirmed; renaming the attendee
  tab (e.g. "Enrolled") is unresolved.
- **Assistant-lead data model (deferred):** a boolean on `ProgramVolunteer`
  (`isAssistantLead`) vs. a new field — affects whether `programsLed` /
  access-resolvers extend cleanly. Flagged, not built.

*(Resolved since drafting: the lead-mentor nav signal rides on the `todo-counts`
`lead` bucket — no new session field was added, closing the "session token vs.
todo-counts" question.)*
