# Staleness notifications

Auto-notifications as things go stale. Two outputs from one shared framework:

1. **Household-direct emails** — as a tracked thing approaches (and passes) its
   lapse date, the affected household is emailed at escalating thresholds.
2. **Weekly board digest** — one email to the admin list (sysadmins + board)
   listing everything currently stale, grouped by kind.

## Problem

Several things in the app go stale on a clock and, today, nobody is told until
someone happens to look:

- **Membership renewals** — the renewal cron opens a RENEWAL process ~2 months
  before the membership-year boundary and sends *one* reminder. If the household
  never finishes, there is no follow-up; the renewal just sits half-done.
- **Trusted adults** — an approved trusted adult is valid one year. There was a
  single 30-day-out warning email, wired directly into
  `runExpirySweep` (`cron/trusted-adult-expiry`).
- **Broken emails** — `Person.emailUndeliverableAt` records that Resend bounced a
  member's address. Nothing surfaced it, so the org keeps emailing an address
  that will never arrive.

These are three instances of one pattern: *find things that are aging out →
nudge whoever can fix it → and give the board a periodic overview.* Rather than
three bespoke cron blocks, this is one small registry-driven framework.

## Decisions (with rationale)

- **Scope for this PR: membership renewals, trusted adults, broken emails.**
  Chosen in the product interview. **Background checks are deliberately excluded**
  for now (see *Deferred*). The framework is built so adding a fourth type is one
  registration, not a rewrite.

- **Fold the trusted-adult 30-day warning into the framework, don't duplicate
  it.** The interview was explicit: the `trusted-adult-expiry` cron *keeps its
  expiry mechanics* (flipping APPROVED → EXPIRED at `reviewBy`), but the warning
  email now goes through the shared layer. So `runExpirySweep` no longer sends
  the warning (its `warned` count and the `expiryWarningSentAt` write are gone);
  the trusted-adult staleness type finds approaching approvals and notifies
  instead. `TrustedAdultReview.expiryWarningSentAt` is now vestigial (kept — a
  column drop is destructive; the ledger is the new dedup) and its doc comment
  says so.

- **Broken emails: notify the household's *other* leads, always digest.** You
  can't email a broken address. So the household-direct notice for a broken
  email goes to the household's *other* leads whose own address is present and
  not itself flagged undeliverable. If there is no such lead, no household email
  is sent — the board digest is the backstop and *always* lists it. The dedup
  key embeds `emailUndeliverableAt`'s timestamp, so a heal-then-rebreak (the
  column self-heals on a later `email.delivered`) is treated as a fresh event.

- **Two crons, not folded into `nightly`.** The repo's cron layout is one
  route per concern (`membership-renewals`, `trusted-adult-expiry`,
  `person-bg-annual`, `scholarship-grace-expiry`, `post-event`, `pending-participants`);
  `nightly` is specifically the facility auto-close + post-event flush. Following
  that grain, the household pass is its own daily route
  (`cron/staleness-notifications`) and the digest a separate weekly route
  (`cron/staleness-digest`). Both are thin `withCron` wrappers over the shared
  runner, exactly like every sibling cron.

- **Board digest recipients = the `reportShopifyFailure` admin set.** sysadmins
  OR board members with an email on file. That is already the app's "tell the
  people who run the org" list, factored here into `emailAdmins`
  (`lib/emailRecipients.ts`) so both paths resolve identically.

- **Dedup via a `NotificationLedger`, digest needs none.** Repeat/overlapping
  runs of the daily cron must not re-send the same household email for the same
  item at the same threshold. A `NotificationLedger(type, subjectKey, threshold,
  sentAt)` row is written *before* the send, guarded by a unique constraint —
  the winner of the insert owns the send, a concurrent run gets P2002 and skips
  (same claim-then-act idiom as `createRenewalProcess`). The weekly digest needs
  no ledger: it is periodic by construction and simply describes current state.

## Data model

```prisma
model NotificationLedger {
  id         Int      @id @default(autoincrement())   // @sensitivity:public
  type       String   // staleness type key, e.g. "MEMBERSHIP_RENEWAL"  @sensitivity:internal
  subjectKey String   // stable per-instance id, e.g. "renewal:12"      @sensitivity:internal
  threshold  Int      // escalation bucket (days-before-lapse; 0 = at/after)  @sensitivity:internal
  sentAt     DateTime @default(now())  // @sensitivity:internal
  @@unique([type, subjectKey, threshold])
}
```

No PII lives in the ledger — `subjectKey` is composed of ids/timestamps only.
Migration is additive (a brand-new table): `20260708060000_staleness_notifications`.

## Framework shape

`lib/staleness/registry.ts` — one small module:

- **`StaleType`** — what each type registers: `{ key, label, thresholds, find(now) }`.
  - `key` — ledger discriminator + digest grouping key.
  - `label` — human heading in the digest.
  - `thresholds` — descending days-before-lapse at which to nudge the household
    (e.g. membership `[30, 7, 0]`, trusted-adult `[30, 7]`, broken-email `[0]`).
  - `find(now)` — returns the current `StaleItem[]`.
- **`StaleItem`** — `{ subjectKey, dueAt, recipients, digestLine, email(threshold) }`.
  - `dueAt` — the lapse date; `null` means "no schedule, stale now" (broken email).
  - `recipients` — household-direct addresses (may be empty → digest-only).
  - `email(threshold)` — builds `{ subject, html }`, wording varying by threshold.
- **`activeThreshold(thresholds, dueAt, now)`** — pure: the *current* escalation
  bucket = the smallest threshold `T` with `daysUntil <= T` (so if the cron
  skipped days and blew past 30 straight to 5, it fires the 7-day stage, not a
  burst of all three). `null` = not yet in any window; `dueAt === null` → `0`.
  Because `daysUntil` only decreases, each bucket becomes active at most once.
- **`runStalenessNotifications(now)`** (daily): for each type, for each item,
  compute `activeThreshold`; if in a window and there are recipients, claim the
  ledger row (`create`; P2002 → already sent, skip) then fan out the email.
- **`sendStalenessDigest(now)`** (weekly): for each type, list every item that is
  in-window (`activeThreshold !== null`), assemble one grouped email, send to
  `emailAdmins`. No ledger.

Adding a type = append one `StaleType` to the `registry` array.

## Flows

**Daily household pass** (`GET /api/cron/staleness-notifications`)
1. `now = new Date()`.
2. For each registered type: `find(now)`.
3. Per item: `t = activeThreshold(...)`; skip if `null` or no recipients.
4. `notificationLedger.create({ type, subjectKey, threshold: t })` — P2002 ⇒ skip.
5. `fanOut(recipients, email(t))`. Returns `{ sent, skipped }` per type.

**Weekly digest** (`GET /api/cron/staleness-digest`)
1. For each type: `find(now)`, keep items with `activeThreshold !== null`.
2. Group `digestLine`s under each `label`; if nothing is stale, send nothing.
3. `emailAdmins("Weekly staleness digest", html, ...)`.

## Prod-safety

- Both routes enter through `withCron` (Bearer `CRON_SECRET`), like every cron.
- Every send is best-effort through `sendEmail` (failures already logged +
  swallowed via `logIntegrationError`); a bad address never fails the cron.
- Ledger claim is written before the send (stamp-then-email, matching
  `renewalReminderSentAt`); an email that fails is not retried — consistent with
  existing crons, avoids infinite re-send loops.
- The unique constraint makes overlapping/retried daily runs idempotent.
- No new env, no external calls, additive-only migration.

## Deliberately deferred

- **Background-check staleness** (annual person BG / `lastBackgroundCheck`
  aging). Excluded from this PR by the interview. Adding it is one `StaleType`
  registration (find people whose check is within N days of the recheck
  boundary, notify their household leads) — no framework change.
- **Per-recipient throttling / unbounded scans.** `find` for broken emails scans
  every flagged `Person` with no pagination; fine at current scale, revisit if
  the flagged set grows large.
- **Member notification preferences.** `Person.notificationSettings` exists but
  is not consulted here (neither do the existing renewal/trusted-adult emails);
  wiring opt-outs is a cross-cutting follow-up.
