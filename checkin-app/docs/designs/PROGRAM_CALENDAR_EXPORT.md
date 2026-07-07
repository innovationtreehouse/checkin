# Program calendar export — "Add to calendar" for program events

**Status:** BUILT (2026-07-06).
**Scope:** `checkin-app/` (paths below are relative to `checkin-app/`).
**Ships:** one route, one pure lib, one UI affordance. **No schema change.**

---

## 1. Problem

A signed-in user looking at a program's detail page (`/programs/[id]`) has no way
to get that program's sessions into their own calendar. The `Event` rows tied to
a program already carry everything a calendar needs — `name`, `startAt`, `endAt`,
`description` — but the only place they surface is staff/attendance views. Parents
and participants re-type dates by hand.

## 2. Decisions (product interview, 2026-07-06)

These were fixed in the interview; rationale where it drove the build.

1. **Mechanism = ICS download + Google Calendar template links. No Google API
   credentials, no subscribable live feed.**
   - A **program-level `.ics`** (RFC 5545) containing *all* the program's events —
     works with Apple Calendar, Outlook, Google (import), everything.
   - A **per-event Google Calendar template link**
     (`https://calendar.google.com/calendar/render?action=TEMPLATE&…`) shown where
     the UI lists individual events — one-click "add this session," no download.
   - We hand-roll both. No OAuth, no stored tokens, no webhook to Google — those
     buy a *live* two-way feed we explicitly deferred (§7).

2. **Placement = an "Add to calendar" affordance on the program detail page, for
   signed-in users who can see the program.** Not a new page, not an email, not a
   kiosk surface. The affordance renders only for a `session` and only when the
   program has events.

3. **Scope = the program's `Event` rows.** One `.ics` per program with every
   event; per-event Google links in the schedule list. Nothing about RSVPs,
   visits, or per-participant filtering — those are roster concerns (§4).

## 3. Data model

**None added.** Reuses the existing `Event` model
([prisma/schema.prisma](../../prisma/schema.prisma) `model Event`): `id`,
`programId`, `name`, `startAt`, `endAt`, `description` — all already
`/// @sensitivity:public`. `Event` has **no location column**, so the emitted
VEVENTs carry no `LOCATION`; the ICS builder supports one if a column is ever
added, but nothing feeds it today.

## 4. Authorization posture (the one real decision to justify)

**The calendar export is gated exactly like the program's *visibility*, not its
*roster*.** Concretely: any signed-in user who can already load
`GET /api/programs/[id]` can download that program's `.ics`.

Why this is the consistent posture:

- The catalog route `GET /api/programs/[id]` returns the program's **`events`** to
  `anyone` — event fields are `public` tier, so the response stripper passes
  `name/startAt/endAt/description` through to every caller who clears the program's
  visibility gate (see `security/registry.ts` `GET /api/programs/[id]`,
  `orderedView` → `anyone: ['public']`). The event schedule is therefore already
  public-catalog data, **not** roster data.
- Contrast `GET /api/events/[id]` (staff-gated) and `GET /api/events/mine`
  (self/household-scoped): those are gated because they embed the **roster** —
  who is enrolled / RSVP'd / present. Each `ProgramParticipant`/`RSVP`/`Visit`
  row is sensitive by *existence* (all-public-tier), so admission must gate it.
  `routeAuthDrift`'s `EDGE_INCLUDE_ALLOWLIST` exists to track exactly those reads.
- This export **reads no roster.** It selects only `Program` scalars + the
  program's `Event` rows. So it needs the same gate the program *page* needs and
  **nothing more**, and it stays off the edge allowlist by construction.

The only visibility restriction on a program is `orgMemberOnly`. The export
mirrors `GET /api/programs/[id]`'s member-only gate: a member-only program's
schedule is served only to the lead mentor, sysadmin/board, or an active org
member; other signed-in users get **403**.

**One deliberate simplification:** the program route also treats a program's
**core volunteers** as privileged, which it resolves by reading `ProgramVolunteer`
(an edge model). This route omits that branch — resolving it would force an
`EDGE_INCLUDE_ALLOWLIST` entry for a route whose whole point is to be roster-free.
A core volunteer who is *not* also an org member is a rare case for a member-only
program, and they still have the per-event Google links on the page and an admin's
copy. Trade documented in the route header.

`withAuth` (mandatory session) is the wrapper: it 401s anonymous and 403s kiosk
before the handler runs, which is precisely "signed-in users only."

## 5. Flows

**Program `.ics`:** browser GETs `/api/programs/[id]/calendar.ics` (cookie auth) →
`withAuth` admits the session → route loads `Program` + its `Event` rows →
member-only gate → `buildIcs(...)` → `200 text/calendar` with
`Content-Disposition: attachment; filename="program-<id>.ics"` and
`Cache-Control: no-store`. Empty program → a valid empty `VCALENDAR`.

**Per-event Google link:** the page reads `program.events` (already in the
`GET /api/programs/[id]` payload) and renders, per event, an anchor built by
`googleCalendarEventUrl(...)` opening Google's pre-filled event template in a new
tab. No server round-trip.

**ICS correctness** (`lib/calendar/ics.ts`, hand-rolled, no dependency):
- `VCALENDAR` → `VERSION:2.0` / `PRODID` / `CALSCALE` / `METHOD:PUBLISH`, one
  `VEVENT` per event.
- Per `VEVENT`: `UID` (stable = `program-event-<id>@<host>`, so a re-download
  updates rather than duplicates), `DTSTAMP`, `DTSTART`/`DTEND` in **UTC**
  (`YYYYMMDDTHHMMSSZ`), `SUMMARY`, `DESCRIPTION`/`LOCATION` when present.
- **CRLF** line endings + trailing CRLF; TEXT escaping of `\ ; , ` and newlines
  (backslash first); 75-char line folding (§3.1).
- Handles **missing end** (omit `DTEND`) and **all-day** (`VALUE=DATE`), both
  unit-tested even though today's `Event` rows always carry a start+end datetime.

## 6. Prod safety

- **No migration, no schema field, no new dependency** — nothing to sequence
  against a deploy.
- **No external call.** The `.ics` is built in-process; the Google link is a
  static URL. No Google credentials, no network dependency, so nothing to fail a
  user request on.
- **No new sensitive surface.** Only `public`-tier event fields leave the server,
  gated by the existing program-visibility rule. No roster read → no
  `EDGE_INCLUDE_ALLOWLIST` entry, no `defineRoute` registry entry needed (`withAuth`
  routes aren't registry-stripped; matches `events/mine`).
- `Cache-Control: no-store` — the schedule can change (events edited/cancelled);
  don't let an intermediary serve a stale calendar.

## 7. Deliberately deferred

- **Subscribable live feed** (a stable `webcal://` / auto-refreshing URL the
  calendar app re-polls). Needs an unguessable per-user token or a public feed
  decision, plus a caching story. Out of scope per the interview — this ships a
  point-in-time download + template links only.
- **Google API integration** (write directly to the user's Google Calendar via
  OAuth). Explicitly out — the template link achieves the same one-click result
  with zero credentials.
- **Per-participant / RSVP-aware calendars** (only the sessions *my* child is in,
  with RSVP state). That is roster data with a different (self/household) gate —
  see `events/mine`; fold into this only if asked.
- **`LOCATION`** — no `Event.location` column exists; the builder is ready if one
  is added.
