# Data Classification Review — ProgramParticipant

> Source: `prisma/schema.prisma` lines 293–309 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — `status` tightened. Other fields confirmed.

Join table: which Participants are enrolled in which Programs. `status` is `PENDING` (awaiting confirmation) or `ACTIVE`. Tracks payment-plan requests. Compound primary key `(programId, participantId)`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| programId | Int | public | ✓ | propagated from `Program.id` (public, confirmed) |
| participantId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| status | ProgramParticipantStatus | internal | ↑ | was public — enrollment-status is now admin/staff-visible only |
| paymentPlanRequested | Boolean | personal | ✓ | confirmed personal — participant sees their own pending-payment-plan via their_own:personal |
| pendingSince | DateTime? | internal | ✓ | confirmed internal — staff workflow timestamp for follow-up |

## Tier counts

public: 1 · pii: 1 · personal: 1 · internal: 2 · secret: 0

## Decision log (2026-05-14)

`status` tightened from public → internal. The enrollment-status field is now admin-only data; the row's existence is still gated by participantId (pii). Other fields confirmed.

**FK propagation:** None — programId and participantId already propagated.

**No route widening:** the routes that surface ProgramParticipant rows (`POST /api/programs/[id]/participants`, `DELETE /api/programs/[id]/participants`, plus admin/cron paths) already correctly grant internal coverage to sysadmin/board, and `their_program_participants:internal` to programLeadMentor on the volunteer-management routes. Consistent with the Membership review, the policy is *not* widened to add `their_own:internal` per route — that's a deliberate per-route policy call.

## Consequences worth tracking

- **`POST /api/programs/[id]/participants` (self-enroll response)** — the enrollee gets back a ProgramParticipant row with `status` stripped (their_own:pii/personal don't cover internal). Client UX that needs to display "Your enrollment is PENDING" right after submitting must either (a) widen the route's authenticated view to include `their_own:internal`, or (b) have the handler return a derived boolean (`{ pending: true }`) alongside the row. The enrollee still sees that they're enrolled (row exists with participantId visible at pii); they just don't see the pending/active distinction.

- **`DELETE /api/programs/[id]/participants` (self-unenroll response)** — same pattern; the deleted-row echo doesn't include status.

- **`programLeadMentor` view on volunteer-management routes** — explicitly grants `their_program_participants:internal`, so lead mentors continue to see status. Sysadmin/board unaffected (always internal).

## Pending consistency items

None.
