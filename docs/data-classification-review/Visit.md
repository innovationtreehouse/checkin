# Data Classification Review — Visit

> Source: `prisma/schema.prisma` lines 405–421 · [Tier legend & how to review](README.md) · [Policy](../SECURITY-POLICY.md)

**Status:** ✅ Reviewed — `id` and timestamps tightened. See consequences below.

A check-in/check-out record for a participant. Optionally associated with an Event. `departed` is null while the visitor is still in the building. Index on `(participantId, departed)` powers the active-visitor lookup in `/api/scan`.

## Fields

| Field | Type | Tier | OK? | Notes |
|---|---|---|---|---|
| id | Int (PK) | personal | ↑ | was public — mild consistency tightening |
| participantId | Int | pii | ✓ | propagated from `Participant.id` during the [Participant](Participant.md) review |
| arrived | DateTime | internal | ↑ | was personal — presence data treated as admin-only |
| departed | DateTime? | internal | ↑ | was personal — presence data treated as admin-only |
| associatedEventId | Int? | public | ✓ | propagated from `Event.id` (public, confirmed) |

## Tier counts

public: 1 · pii: 1 · personal: 1 · internal: 2 · secret: 0

## Decision log (2026-05-14)

`arrived` and `departed` tightened to `internal` — presence data is admin-only by policy. `id` lifted to `personal` for mild consistency. participantId already at pii from propagation; associatedEventId stays public.

The user's choice deliberately accepts UX regressions on the non-admin Visit-surfacing routes (see Consequences). The policy intent is: who-was-where-and-when is admin/staff data, not member-readable through the security boundary. Per-route widening can be applied later if a flow needs to surface visit times to non-admins.

**FK propagation:** None.

**No route widening this review.** Every existing view continues to work for sysadmin/board (full internal coverage). Other roles will lose `arrived`/`departed` visibility — see below.

## Consequences worth tracking

These are the routes whose non-admin callers lose `arrived` / `departed` visibility. Each is a candidate for per-route widening if the UX matters:

- **`GET /api/household/visits` (authenticated)** — household members and leads see Visit rows but no times. The "your household's visits" page becomes a list of rows with participant ids and event ids only. Widening would mean adding `their_own:internal` + `their_households:internal` (and accepting that those tokens also grant internal-tier Participant fields like `sysadmin`, `keyholder` to household members of each other — a meaningful escalation).

- **`GET /api/profile/visits` (self)** — UNAFFECTED. The view already includes `their_own:internal`. Self-visit history continues to work.

- **`DELETE /api/attendance` (authenticated/keyholder)** — the deleted-row echo in the response no longer includes `arrived`/`departed` for non-admin callers. Operation succeeds; the response just shows the bare ids. Keyholder kiosk-side delete UX loses the time confirmation.

- **`POST /api/attendance/manual` (self)** — when a user submits a manual check-in, the response Visit row lacks `arrived`. Functionally the check-in worked; the client just doesn't get the time echoed. Could widen with `their_own:internal` if needed.

- **`/api/scan` (kiosk + everyone)** — UNAFFECTED. Uses `dangerously_allow_all_data_access: true` (per-role filtering in-handler, stripper bypassed).

- **`POST /api/attendance`** — UNAFFECTED. Same dangerous-allow pattern.

## Pending consistency items

None.
