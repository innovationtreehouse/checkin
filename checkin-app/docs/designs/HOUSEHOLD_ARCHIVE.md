# Archiving / un-archiving Families (households)

**Status:** BUILT (2026-07-08). Additive, nullable stamp + a shared "active
household" filter + three write guards + a board/sysadmin toggle in the
membership-ops households view.
**Scope:** `checkin-app/` (paths below are relative to `checkin-app/`).

---

## 1. Problem

A household (UI: "family") that has left the Treehouse — moved away, aged out,
duplicate created in error — clutters every board list, still receives renewal
reminders, and its members can still enroll, scan, and start applications.
Deleting is not an option: attendance, membership, background-check, and audit
history must stay intact for compliance. We need a **soft archive**: set the
household aside so it drops out of the day-to-day surfaces and its members can't
start new activity, while every historical row stays exactly where it is and a
single action fully restores it.

Archive is **not** the same as membership **Deny** (`OrgMembershipStatus.DENIED`,
which blocks login for every member at the auth layer). Archive is softer and
orthogonal: an archived household's members can still **log in and view** their
own history — they just can't **start new activity** (enroll, scan, apply), and
the household disappears from board-facing default lists. The two can coexist.

## 2. Decisions (from the product interview) + rationale

| Decision | Rationale |
|---|---|
| **Soft archive via a nullable `Household.archivedAt DateTime?` stamp** (`@sensitivity:internal`). | One nullable column; presence of a timestamp == archived, and it records *when*. Additive/nullable → expand-only migration, safe on the live DB. |
| **Who archived is captured in `AuditLog`, not a second column.** | The audit log already records `actorId` + before/after on every board action (mirrors the household `Deny`/membership-archive rows). No new column earns its keep. |
| **Board / sysadmin only**, surfaced in the **membership-ops households** view (where households are already managed). | Same role gate (`isSysadmin`/`isBoardMember`) and same screen as grant/revoke/deny — no new nav, no new permission concept. |
| **Archived households are HIDDEN from default lists / searches / pickers.** The households management list gets an **"include archived"** toggle to find them for un-archive. | Keeps the board's daily surfaces clean; the toggle is the one place you go to bring a family back. |
| **Archived households' members are BLOCKED from new activity** — program enrollment, check-in/scan, starting a membership application — guarded at the **shared service/route level**. | One guard per write choke-point, not per caller, so a future caller can't forget it. Returns a clear 4xx ("household is archived"), never a 500. |
| **Notification fan-outs & crons SKIP archived households** (renewal sweep, person-BG sweep, new-program blast, audit/compliance chase lists, nav badges). | An archived family shouldn't be emailed or chased. Enforced by composing one shared `archivedAt: null` filter into the existing predicates. |
| **History fully intact; un-archive restores everything. No purge.** | Un-archive is just clearing the stamp — every enrollment, visit, membership, and audit row is untouched, so restore is total and instant. |

## 3. Data model

```prisma
model Household {
  ...
  /// Soft-archive stamp: non-null == the household is archived (set aside).
  /// Hides it from default board lists/searches/pickers, skips it in
  /// notification fan-outs + crons, and blocks its members from starting new
  /// activity (enroll / scan / membership application). History is untouched;
  /// clearing this restores everything. Who archived is in the AuditLog row,
  /// not a column. @sensitivity:internal
  archivedAt DateTime?
}
```

Migration `20260708010000_household_archive` — additive, nullable, no backfill:

```sql
ALTER TABLE "Household" ADD COLUMN "archivedAt" TIMESTAMP(3);
```

## 4. The shared "active household" filter

`src/lib/household/filters.ts` gains the single source of truth for "not
archived", and folds it into the existing broken/unclaimed predicates so every
audit list + nav badge that already used them skips archived for free:

```ts
export const ACTIVE_HOUSEHOLD_WHERE: Prisma.HouseholdWhereInput = { archivedAt: null };
/** Person-scoped: their household isn't archived. For person list/fan-out queries. */
export const ACTIVE_HOUSEHOLD_PERSON_WHERE: Prisma.PersonWhereInput = { household: { archivedAt: null } };
```

`BROKEN_HOUSEHOLD_WHERE` and `UNCLAIMED_OR_BROKEN_HOUSEHOLD_WHERE` are extended
with `archivedAt: null`, so the four call sites that consume them (broken-
households list, unclaimed list, and both nav todo-counts) drop archived with no
per-site edit.

## 5. Write guards (block new activity)

`src/lib/household/archive.ts`:

- `HouseholdArchivedError` — thrown by the guard; each route maps it to **409**
  with the message *"This household is archived."*
- `assertHouseholdActive(db, householdId)` — one PK lookup; throws if archived.
- `setHouseholdArchived(householdId, archived, actorId)` — the mutation:
  idempotent (archiving an already-archived household is a no-op), stamps/clears
  `archivedAt`, and writes an `AuditLog` `EDIT` row (`tableName: "Household"`,
  before/after `{ archivedAt }`) so who/when is recorded.

Three write choke-points call the guard (the exact points the interview named):

| Write | File | Guard |
|---|---|---|
| Program enrollment POST | `api/programs/[id]/participants/route.ts` | `assertHouseholdActive` on the enrollee's household → 409 |
| Check-in / scan POST | `api/scan/route.ts` | `assertHouseholdActive` on the scanned person's household → 409 |
| Start membership application | `lib/membership/intake.ts` `startIntake` | reuses the already-loaded `household.archivedAt` → `IntakeError("archived")` → 409 (same invariant, intake's own error channel; no redundant query) |

## 6. The sweep — every household/person query that feeds a list, cron, or fan-out

Root-cause altitude: prefer composing the one shared filter over sprinkling
`archivedAt: null`. Decided case-by-case:

### Touched (archived now excluded)

| Query | File | Why |
|---|---|---|
| Households management list (GET) | `api/membership-ops/households/route.ts` | Default hides archived; `?includeArchived=1` shows them (the un-archive surface). `archivedAt` added to the row select for the badge. |
| Broken-households list + nav count | `filters.ts` `BROKEN_HOUSEHOLD_WHERE` | Archived family shouldn't be flagged "broken/needs a lead". |
| Unclaimed households list + nav count | `filters.ts` `UNCLAIMED_OR_BROKEN_HOUSEHOLD_WHERE` | Same — no point chasing an archived family to claim. |
| Households-missing-contact list + nav count | `lib/emergencyContacts/service.ts` `findHouseholdsMissingValidContact` | Compliance chase list; archived is out of scope. |
| Membership compliance dashboard | `api/membership-audit/compliance/route.ts` | Stale-BG / revoked / denied buckets skip archived. |
| Enroll picker ("eligible participants") | `api/programs/[id]/eligible-participants/route.ts` | Archived members can't be enrolled, so don't offer them. |
| Renewal sweep + bulk-renewal | `lib/membership/renewal.ts` (`runRenewalSweep`, `openRenewalsForAllActive`) | **Representative cron** — no renewal process opened, no reminder emailed, for archived households. |
| Person-BG annual sweep | `lib/membership/personBgTriggers.ts` `runPersonBgAnnualSweep` | No new BG obligation for an archived family's members. |
| New-program announcement blast | `lib/notifications.ts` `notifyNewProgramAnnounced` | Don't email archived families about new programs. |

### Deliberately NOT touched (and why)

| Query | File | Why left alone |
|---|---|---|
| Household detail GET (by id) | `api/membership-ops/households/[id]/route.ts` | Direct-id detail view; must stay reachable to *un-archive* from it. |
| Emergency-contacts safety board | `api/safety/emergency-contacts/route.ts` | **Safety.** Archive does not force-checkout; a member checked in *before* archiving still has an open visit. Hiding the household could hide a person physically in the building from the emergency board. Presence (`isPresent`) already scopes what matters. |
| Pending-participant kick / final-warning | `api/cron/pending-participants/route.ts` | Freeing a program seat held by an archived household is correct; the "emails" here are `logger.info` stubs (no real fan-out). |
| Scholarship-grace-expiry auto-withdraw | `api/cron/scholarship-grace-expiry/route.ts` | Same — releasing a held seat is always right. |
| Nightly facility-close sweep | `api/cron/nightly/route.ts` | Checks out abandoned visits; archived members are blocked from *new* check-ins, and closing an already-open visit is always correct. |
| `emailHouseholdLeads(householdId, …)` | `lib/emailRecipients.ts` | Single-household send; the iterating callers (renewal) are already filtered upstream, so no double-guard needed. |
| `emailBoardMembers`, `notifyReviewers` | `lib/emailRecipients.ts`, `review.ts` | Board/reviewer fan-outs, not household-scoped. |
| `sendNotification`, `sendCheckinNotifications` | `lib/notifications.ts` | Fired by enroll/scan, which are already blocked for archived households. |
| `beginRenewal` / `submitIntake` | `lib/membership/renewal.ts`, `intake.ts` | *Continue* an in-flight process that predates archiving; the sweep guard stops any *new* one from opening. Un-archive is the intended path to resume. |

## 7. UI

`membership-ops/households/page.tsx` (board/sysadmin):
- An **"Include archived"** checkbox that refetches with `?includeArchived=1`.
- An **Archived** badge on archived rows.
- **Archive** / **Un-archive** buttons in the row actions (calls the households
  POST with `{ householdId, archive: boolean }`).

The households POST route already gates `isSysadmin`/`isBoardMember` and handles
the sibling `active`/`deny` toggles; archive is one more branch there (no new
route, no new `routeAuthDrift` entry, no new permission concept).

## 8. Prod safety

- **Migration is expand-only** (one additive, nullable column, no backfill) —
  safe under the rolling deploy: draining old tasks simply ignore the new column.
- **No destructive drop**; un-archive is a plain `UPDATE … SET archivedAt = NULL`.
- **Guards fail closed with a 4xx**, never a 500, and never fail a scan/enroll on
  a best-effort path — the archived check is a cheap indexed PK read.
- **Security:** `archivedAt` is `@sensitivity:internal`; `classifications.ts`
  regenerated by `prisma generate` (never hand-edited). No new API route (archive
  rides the existing sanctioned households POST), so no `routeAuthDrift` change.

## 9. Deliberately deferred

- **No auto-archive** (e.g. sweep long-inactive households). Manual board action
  only — archiving is a judgement call.
- **No force-checkout on archive** — see the safety-board rationale in §6.
- **No bulk archive UI** — one household at a time; add a multi-select later if
  the board asks.
- **No archive reason / note field** — YAGNI; the audit row records who + when.
- `beginRenewal`/`submitIntake` continuation is not blocked (§6) — revisit only
  if a real case of "archived mid-renewal must hard-stop" appears.
