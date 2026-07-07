# Program mailing lists → Google Groups sync

Status: implemented (integration credentials are an **infra follow-up** — see
§"Provisioning"). Product decisions from the 2026-07 interview are recorded
inline as **[decision]**.

## Problem

A program (a class/cohort) wants a single mailing list its active participants
can reach. Treehouse already runs on Google Workspace, so the natural list is a
**Google Group**. We want the app to keep that group's membership in lockstep
with who is actively enrolled: add people when they become active, remove them
when they withdraw, and self-heal any drift — without ever letting a Google
outage break the enrollment/withdrawal actions that trigger it.

## Decisions

- **[decision] Config lives on the program.** `Program.googleGroupEmail`
  (`String?`, `@sensitivity:internal`) is the group address, board-set on the
  program-ops program settings surface and **validated as an email** server-side.
  Null = this program has no group; sync is a no-op for it. Internal tier because
  it is operational config, not public catalog data; the `GET /api/programs/[id]`
  view already grants `everyones:internal` to sysadmin/board (the only roles that
  see/edit the config card), and hides it from lead mentors / the public.

- **[decision] Who gets added — mirrors how notifications resolve recipients
  today.** `lib/notifications.ts › sendCheckinNotifications` notifies **the
  participant themselves** (their own `Person.email`) **plus every household
  lead** (`Person` in the same household with `isHouseholdLead = true`). We reuse
  that exact rule for group membership: a participant contributes their own email
  and all their household leads' emails (deduped, lowercased). Consequences,
  identical to notifications: a dependent child with no email of their own is
  represented in the group by their household lead(s); an adult who self-enrolls
  and is their own lead resolves to just their one address.

- **[decision] Event-driven push, best-effort.** When a participant becomes
  **ACTIVE**, their resolved emails are **added**; on withdrawal/removal they are
  **removed** (but only the ones no other active participant of the same program
  still needs — a shared household lead stays). A Google failure **must never
  fail the triggering user action**: the push is fire-and-forget at the service
  level, wrapped so it can only log + report (Link Status), never throw. The
  nightly reconcile is the safety net that heals anything a push dropped.

- **[decision] Nightly reconcile + manual "Sync now".** A cron does a full diff
  per configured program (desired = active participants' resolved emails;
  current = the group's members): add missing, remove extras. A board-only
  "Sync now" button on program-ops runs the same reconcile for one program on
  demand.

- **[decision] Directory API over a service account with domain-wide
  delegation.** Auth is the Google **Admin SDK Directory API**
  (`admin.directory.group.member` scope) via a Workspace **service account**
  impersonating an admin (`sub`). Credentials come from env
  (`GOOGLE_SA_KEY_JSON` = the full service-account key JSON, `GOOGLE_SA_SUBJECT`
  = the admin user to impersonate). **When either is absent the integration is
  cleanly OFF**: the config UI still works, every sync path logs-and-skips, and
  config-health reports it unconfigured (see §Off-state).

- **[decision] No new npm dependency.** The Directory API is plain REST, and its
  OAuth2 is a JWT-bearer assertion we sign with Node's built-in `crypto`
  (`RSA-SHA256` over `base64url(header).base64url(claims)`, exchanged at
  `oauth2.googleapis.com/token`). That is ~20 lines and avoids pulling in
  `googleapis`/`google-auth-library` (hundreds of transitive deps) for three
  endpoints. If Google's auth ever grows hairier than a static JWT (e.g. workload
  identity federation), `googleapis` becomes the justified fallback — it is not
  needed today.

## Data model

One additive, nullable column (expand-only, no backfill):

```
Program.googleGroupEmail  String?   /// @sensitivity:internal
```

Migration `20260708050000_program_google_group`. No new tables: the Google Group
itself is the state store; the app holds only the address.

## Components

- `lib/googleGroups.ts` — the **client**. Owns JWT signing + token cache (5-min
  early refresh), and `listGroupMembers` / `addGroupMember` / `removeGroupMember`.
  Every network call goes through `googleFetch` (a 15s `AbortSignal.timeout`
  wrapper — the same seam `lib/shopify.ts › shopifyFetch` uses, so tests mock
  `global.fetch`). Typed failures are `GoogleGroupsError`. Idempotency is baked
  into the client: add treats **409** (already a member) as success, remove
  treats **404** (not a member) as success — so retries and reconcile overlap are
  harmless.

- `lib/program/groupSync.ts` — the **shared service** that maps program/person →
  emails and drives the client:
  - `resolveParticipantGroupEmails(personId)` — self + household-lead emails.
  - `reconcileProgramGroup(program)` — full diff for one program. Removes only
    members whose Directory `role` is `MEMBER`; **never removes OWNER/MANAGER**
    (so a human owner or the service account isn't reconciled out of its own
    group). Throws on a Google failure so callers decide how loud to be.
  - `pushGroupAddOnActivation(program, personId)` /
    `pushGroupRemoveOnWithdrawal(program, personId)` — the best-effort event
    pushes. Both **swallow all errors** into `logger.error` +
    `logIntegrationError("google-groups", …)`; they return `void` and never
    throw, so no user action can fail on them. Both no-op immediately when the
    program has no group or the integration is unconfigured.

## Flows

**Activation → add.** The three post-#930 activation points each call
`pushGroupAddOnActivation` from the service level:
1. `POST /api/webhooks/shopify` (paid order flips PENDING→ACTIVE),
2. `POST /api/finance-ops/payment-plans` (scholarship/payment-plan approval),
3. `POST /api/programs/[id]/participants` (free program / board comp override
   creates an ACTIVE row directly).

Adding is idempotent, so no diff is needed on the hot path — we just add the
one person's emails.

**Withdrawal/removal → remove.** Fired from **one** place:
`lib/program/capacity.ts › withdrawAndReleaseHold`, the single shared exit path
that DELETE `/api/programs/[id]/participants` and both withdrawal crons
(`pending-participants`, `scholarship-grace-expiry`) already route through. The
person is deleted from the roster first, so the removal recomputes the program's
*remaining* desired set and removes only the leaving person's emails that no
remaining active participant still needs. PENDING kicks (crons) were never in the
group, so their removal is a harmless no-op.

**Reconcile.** `GET /api/cron/program-google-group-reconcile` (withCron +
`CRON_SECRET`) iterates programs with a group set and reconciles each, isolating
a failing program from the rest (log + Link Status, continue). **Schedule is an
infra follow-up** — like the other crons, the route exists but nothing invokes it
until an EventBridge/scheduler entry is added in the infra repo (mirror the
existing cron schedule wiring).

**Manual sync.** `POST /api/programs/[id]/sync-google-group` (withAuth,
sysadmin/board) runs `reconcileProgramGroup` for one program and returns
`{ added, removed }`, surfacing a 502 if Google errors (also logged to Link
Status). Backs the "Sync now" button on the program-ops general tab.

## Off-state (unconfigured) — mirrors Zoho/Shopify

`config.googleGroupsConfigured()` is true only when **both** env vars are set.
When false:
- `pushGroupAdd/Remove` and `reconcileProgramGroup` return early (log-and-skip);
- the manual-sync route returns 503 "not configured";
- the reconcile cron returns `{ configured: false }` and does nothing;
- `lib/configHealth.ts` gains a `google-groups` check that reports the state.
  Following the `resend-email` idiom, it is a **gap only in prod** (green in
  dev/local, where the feature is legitimately off), and its detail names the two
  env vars to set. This is where the pending infra provisioning surfaces to the
  board on System Status.

Failures of a *configured* integration are reported exactly like Shopify's:
`logIntegrationError("google-groups", …)` → System Status › Link Status.

## Provisioning (infra follow-up — NOT done in this PR)

To turn the integration on in an environment:
1. Create a Workspace service account, enable the Admin SDK, and grant it
   **domain-wide delegation** for scope
   `https://www.googleapis.com/auth/admin.directory.group.member`.
2. Set `GOOGLE_SA_KEY_JSON` to the downloaded key JSON and `GOOGLE_SA_SUBJECT`
   to an admin user's email (the `sub` the service account impersonates — DWD
   cannot act as the service account itself for Directory writes).
3. Add a scheduler entry that hits the reconcile cron with the `CRON_SECRET`
   bearer, on the desired cadence (nightly).

## Deliberately deferred

- **No new group creation** — the group must already exist in Workspace; the app
  only manages membership of an address it's given.
- **Group is treated as app-owned for its MEMBER role.** Reconcile removes
  MEMBER-role addresses that aren't active participants. Don't hand-add members
  you want to keep; add them as OWNER/MANAGER (never touched) or, better, keep
  manual lists in a different group. `ponytail:` naive full-diff per program —
  fine at Treehouse's program count; batch the Directory calls if it grows.
- **No per-role mapping** (mentors/volunteers) — only active *participants* sync,
  matching the notification-recipient rule above.
- **Email-change lag** — if a person changes their email, the old address lingers
  in the group until the next reconcile removes it (it's no longer in the desired
  set). Acceptable; the nightly diff heals it.
