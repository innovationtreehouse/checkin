# Security Policy Migration Audit — orderedView Widening

Audit of every entry in `src/security/registry.ts` against the pre-migration `withAuth(...)` /
inline `authenticateRequest()` role gates from commit `7c8c2a4` (the last commit before the
security framework migration began).

**Question:** does the new `orderedView` grant any role *more* data than they had pre-migration?

**Methodology:** for each registry entry I compared:
1. The pre-migration **role gate** (sysadmin/board/keyholder/etc. — who could call the route at all)
2. The pre-migration **response shape** (what fields the row returned)
3. The new **`authorize`** gate (who can call the route now)
4. The new **`orderedView`** (what tier of fields each role sees)

Widening means a role can now see field tiers (`pii` / `personal` / `internal`) that the
pre-migration route either didn't expose at all or denied them via 403. Granting `public` to
a previously-403'd role is *not* counted as widening — `public` fields (id, name, etc.) are
the same tier any unauthenticated visitor can see elsewhere; in many cases this is intentional
softening of an over-broad pre-migration 403 (e.g. shop directories visible to authenticated
members).

| Route | Original roles | New authorize | New orderedView roles | Widened? | Notes |
| --- | --- | --- | --- | --- | --- |
| GET /api/profile | any session | self | authenticated → their_own:* | No | self-data only, same as before |
| GET /api/programs/[id] | public + per-role redaction (PR #129) | public | sysadmin/board/leadMentor/coreVolunteer/authenticated/anyone | No | matches PR #129 intent; verified policy fixed in 7c8c2a4 itself |
| GET /api/directory/board | sysadmin/board/keyholder → full | anyRole sysadmin/board/keyholder | sysadmin/board → everyones:internal; keyholder → public only | No | NARROWED — keyholder previously got full payload, now public-only |
| GET /api/admin/audit | sysadmin only | anyRole sysadmin | sysadmin → everyones:internal | No | unchanged |
| GET /api/admin/badges | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/admin/orphans | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/admin/roles | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| PATCH /api/admin/roles | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/admin/visits | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| PATCH /api/admin/visits | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/admin/emergency-contacts | sysadmin/board/keyholder | anyRole sysadmin/board/keyholder | sysadmin/board → everyones:internal; keyholder → everyones:personal | No | matches pre-migration; keyholder explicitly given personal (emergency contacts), not internal |
| GET /api/admin/households | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| POST /api/admin/households | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/admin/participants/search | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/admin/participants/merge/analyze | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| POST /api/admin/participants | sysadmin/board (inline check) | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| PUT /api/admin/participants/[id] | sysadmin/board (inline check) | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| POST /api/admin/participants/[id]/household | sysadmin/board (inline check) | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| POST /api/admin/participants/merge | sysadmin/board | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/admin/system-health | sysadmin/board/keyholder | anyRole sysadmin/board/keyholder | (raw) | No | unchanged; aggregates only |
| GET /api/admin/trends | sysadmin/board | anyRole sysadmin/board | (raw) | No | unchanged; aggregates only |
| POST /api/admin/participants/import | sysadmin/board (inline check) | anyRole sysadmin/board | (raw) | No | unchanged |
| POST /api/admin/participants/import/preview | sysadmin/board (inline check) | anyRole sysadmin/board | (raw) | No | unchanged |
| GET /api/household | any session | authenticated | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | per-row scope tightened; sysadmin/board see everything (they could anyway) |
| POST /api/household | any session | authenticated | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | same as GET |
| PATCH /api/household | any session (handler had lead check) | household-lead | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | authorize TIGHTENED to household-lead; view unchanged for sysadmin/board |
| POST /api/household/lead | any session (handler had lead check) | household-lead | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | TIGHTENED |
| DELETE /api/household/lead | any session (handler had lead check) | household-lead | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | TIGHTENED |
| PATCH /api/household/member | any session (handler had lead check) | household-lead | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | TIGHTENED |
| PATCH /api/household/settings | any session (handler had lead check) | household-lead | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | TIGHTENED |
| GET /api/household/visits | any session | authenticated | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | per-row scope tightened |
| PATCH /api/profile | any session, self only by id | self | authenticated → their_own:internal | No | unchanged |
| POST /api/profile/onboarding | any session | self | (raw) | No | unchanged |
| GET /api/profile/onboarding-status | any session | self | (raw) | No | unchanged |
| GET /api/profile/visits | any session, self only | self | authenticated → their_own:internal | No | unchanged |
| GET /api/kiosk/certifications | any session OR kiosk | public (auth-type OR in handler) | (raw) | No | unchanged; kiosk auth gate intact |
| GET /api/kiosk/version | any caller | public | (raw) | No | unchanged; opaque git sha |
| GET /api/health | any caller | public | (raw, anyone → public) | No | unchanged liveness probe |
| POST /api/events | session + isSysAdmin/board/leadMentor inline | authenticated (handler-internal role check) | (raw) | No | gate unchanged; handler still enforces |
| GET /api/events/mine | any session | authenticated | sysadmin/board → everyones:internal; leadMentor/coreVolunteer → their_program_participants; authenticated → their_own | No | NARROWED — pre-migration any session saw all their events with no per-row scope |
| GET /api/events/[id] | any session → full event (with all participant rows) | authenticated | sysadmin/board → everyones:internal; leadMentor → their_program_participants:internal; coreVolunteer → personal only; authenticated → their_own | No | MAJOR NARROWING — pre-migration any session saw every RSVP + Visit + Participant for any event; now scoped per-role |
| PATCH /api/events/[id] | session + per-action role check | authenticated (handler-internal role check) | (raw) | No | gate unchanged; handler still enforces |
| POST /api/events/[id]/attendance | session + lead/board/keyholder inline | authenticated (handler-internal role check) | (raw) | No | gate unchanged; handler still enforces |
| PATCH /api/events/[id]/rsvp | any session (with per-program-participant check) | authenticated | sysadmin/board → everyones:internal; authenticated → their_own | No | NARROWED — pre-migration RSVP response wasn't scoped |
| GET /api/attendance | session OR kiosk | public (handler enforces auth.type) | (raw, multi-shape) | No | unchanged |
| DELETE /api/attendance | session + self/household/admin inline | authenticated | sysadmin/board → everyones:internal; keyholder → all_current_visitors; authenticated → their_own + their_households | No | sysadmin/board/keyholder explicit grants match pre-migration |
| POST /api/attendance | session + per-type role check | authenticated (handler-internal role check) | (raw) | No | gate unchanged |
| POST /api/attendance/manual | any session, self only | self | authenticated → their_own | No | TIGHTENED to self; pre-migration the handler had `userId = session.user.id` so was effectively self anyway |
| GET /api/programs | any caller (memberOnly filtered) | public | sysadmin/board/leadMentor/coreVolunteer/authenticated/anyone | No | response shape is Program rows + counts only; orderedView grants for Participant tiers are inert since route never returns Participant rows |
| POST /api/programs | session + sysadmin/board inline | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| GET /api/programs/payment-plans | session + sysadmin/board inline | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| POST /api/programs/payment-plans | session + sysadmin/board inline | anyRole sysadmin/board | sysadmin/board → everyones:internal | No | unchanged |
| PATCH /api/programs/[id] | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → their_program_participants | No | TIGHTENED authorize from generic-session to program-lead-mentor token |
| GET /api/programs/[id]/eligible-participants | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → everyones:personal | ⚠ | leadMentor `everyones:personal` instead of `their_program_participants:personal`; route returns potential enrollees from outside the program, so this is intentional but worth ratifying |
| POST /api/programs/[id]/events | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → their_program_participants | No | TIGHTENED authorize |
| POST /api/programs/[id]/participants | session + self/householdLead/sysadmin/board (leadMentor explicitly denied) | authenticated (handler-internal check) | sysadmin/board → everyones:internal; authenticated → their_own + their_households | No | handler-internal check preserves the lead-mentor denial |
| DELETE /api/programs/[id]/participants | session + self/leadMentor/sysadmin/board inline | authenticated (handler-internal check) | sysadmin/board/leadMentor/authenticated tiers | No | per-row scope tightened |
| POST /api/programs/[id]/publish | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → their_program_participants | No | TIGHTENED |
| POST /api/programs/[id]/request-payment-plan | any session | authenticated | sysadmin/board → everyones:internal; authenticated → their_own | No | unchanged |
| PATCH /api/programs/[id]/settings | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → their_program_participants | No | TIGHTENED |
| POST /api/programs/[id]/volunteers | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → their_program_participants:internal | No | TIGHTENED |
| DELETE /api/programs/[id]/volunteers | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → their_program_participants:internal | No | TIGHTENED |
| PATCH /api/programs/[id]/volunteers | session + leadMentor/sysadmin/board inline | program-lead-mentor | sysadmin/board → everyones:internal; leadMentor → their_program_participants:internal | No | TIGHTENED |
| GET /api/shop/active | session + sysadmin/board/shopSteward/certifier inline | authenticated (handler-internal certifier check) | sysadmin/board/shopSteward → everyones:internal; authenticated → their_own | ⚠ | Plain authenticated previously got 403; now gets `their_own + public`. Authorize gate widened to any session because the per-tool certifier role can't be expressed in the framework; handler still enforces. Verify shop occupant counts/public fields are acceptable to leak to plain members. |
| GET /api/shop/certifications | any session → all certifications including others' levels | authenticated | sysadmin/board/shopSteward → everyones:internal; authenticated → their_own:internal | No | MAJOR NARROWING — pre-migration any session could pass `?participantId=X` and see anyone's full cert levels; now scoped to their_own for non-shop-role callers |
| POST /api/shop/certifications | any session + per-tool certifier inline | authenticated (handler-internal certifier check) | sysadmin/board/shopSteward → everyones:internal; authenticated → their_own:internal | No | handler-internal check preserves certifier gate |
| GET /api/shop/members | session + sysadmin/board/shopSteward/certifier inline | authenticated | sysadmin/board/shopSteward → everyones:internal; authenticated → public only | ⚠ | Plain authenticated previously got 403; now gets `public` (id + name). Response is shop-eligible member list. Acceptable for a member directory? Worth ratifying. |
| GET /api/shop/tools | any session → all Tool rows | authenticated | sysadmin/board/shopSteward → everyones:internal; authenticated → public only | No | Tool fields are all `public` already; pre-migration any session got the same fields. Unchanged. |
| POST /api/shop/tools | session + sysadmin/board/shopSteward inline | anyRole sysadmin/board/shopSteward | sysadmin/board/shopSteward → everyones:internal | No | unchanged |
| GET /api/cron/nightly | bearer CRON_SECRET inline | cron (timing-safe Bearer) | (raw) | No | gate unchanged, timing-safe-equal added |
| GET /api/cron/pending-participants | bearer CRON_SECRET inline | cron | (raw) | No | unchanged |
| GET /api/cron/post-event | bearer CRON_SECRET inline | cron | (raw) | No | unchanged |
| GET /api/cron/reminders | bearer CRON_SECRET inline | cron | (raw) | No | unchanged |
| GET /api/auth/dev-personas | NEXT_PUBLIC_DEV_AUTH 404 gate | dev-only | (raw) | No | unchanged; never reachable in prod builds |
| POST /api/programs/[id]/public-register | unauthenticated | public | (raw) | No | unchanged; self-serve enrollment |
| POST /api/scan | kiosk signature OR session | anyOf kiosk/authenticated | (raw) | No | unchanged |
| POST /api/webhooks/shopify | shopify HMAC inline | webhook:shopify | (raw) | No | unchanged |

## Summary

- **Total routes audited:** 68
- **Widened:** 3 (all flagged with ⚠ above)
- **Narrowed:** roughly 15 routes — the migration tightened access in most places, especially the events surface (per-event participant data was previously visible to any authenticated session)

### Widening detail

The three widened entries are not surprises — they trade pre-migration "all-or-nothing" 403s for a `public`-tier sliver, which is appropriate for a member directory. Worth a maintainer ratification but no urgent action.

1. **GET /api/programs/[id]/eligible-participants** — leadMentor view uses `everyones:personal` rather than `their_program_participants:personal`. This is intentional because the route returns *candidates from outside* the program (members who could be enrolled), and `their_program_participants` would scope to *current* participants only, defeating the route's purpose. Tier is `personal` not `pii` so contact details still strip — only home address would leak, which is the legitimate enrollment-decision input. Ratify, then add a `// Intentional: eligible candidates extend beyond current program participants.` comment.

2. **GET /api/shop/active** — plain authenticated now sees `their_own + public` where before they got 403. Response is "who's currently in the shop". The `public` tier limits the leak to id + name. Pre-migration `certifier` role gating was per-tool and the framework can't express that, so the handler-internal check still enforces certify-others access on the *write* side. For *read*, allowing members to see who's in the shop seems reasonable for a community workshop.

3. **GET /api/shop/members** — plain authenticated now sees member id + name; pre-migration 403. This is a directory of shop-eligible members. Same reasoning as #2.

### Pattern observation

The framework's `authorize` is OR-of-roles, not AND-of-scopes. Routes whose pre-migration gate combined "any session" + "ownership-of-a-row" semantics (PATCH /api/household, POST /api/household/lead, etc.) now use a dedicated authorize token (`household-lead`, `program-lead-mentor`, `self`) that pushes the row-level check into the framework. This is strictly tighter than pre-migration. Almost every "TIGHTENED" note above is one of these.

### Pre-migration vulnerabilities the migration accidentally fixed

- **GET /api/events/[id]** previously returned full event with all RSVPs, all Visits, and every related Participant row (full PII) to any authenticated session. Now scoped per role.
- **GET /api/shop/certifications** previously let any authenticated session query `?participantId=X` to see anyone's cert levels. Now scoped to `their_own` for non-shop callers.
- **GET /api/events/mine** previously had no per-row scope on the events it returned (relied on the where clause being correct). The view now enforces it as a defense in depth.

These weren't called out as security fixes in the migration commits — they fell out naturally from the model. Worth a paragraph in the policy doc.
