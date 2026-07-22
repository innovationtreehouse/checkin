# Membership Sync — Google Groups (email) + Slack channels

**Status:** Design, for review. No code. Supersedes PRs #1156 and #1157, both closed in favour of this doc.
**Date:** 2026-07-22
**Purpose:** Keep Google Group membership (program groups, the members list, the newsletter) and Slack channel membership in step with who is actually enrolled and current — while treating a person's own decision to leave a list as a first-class, auditable, permanent choice.

This doc is written so an implementation session can pick it up cold. Read §1 for what is true today, §2 for the model, §3 for the part that is new and most likely to be argued with, then §7 for the PR sequence.

---

## 1. Current state

**Nothing ships today.** There is no Google Groups or Slack integration in `main`. Two PRs carried an earlier version of this feature and are now closed:

- **#1156** — schema (`SyncState`, `ProgramSlackAuth`), Google/Slack clients, desired-state engine. Inert; nothing called it.
- **#1157** — one line in `src/security/scopeBindings.ts` queueing `ProgramSlackAuth`, split out under the boundary-isolation rule.

Their engine design is carried forward here largely unchanged (§2). What changed is §3 — consent and audit — which is why the doc exists rather than a rebase.

Relevant existing machinery this design reuses rather than reinvents:

- `AuditLog` (`actorId`, `action`, `tableName`, `affectedEntityId`, `oldData`, `newData`) — the app's existing audit trail. Note the `tableName` accuracy rule: a change to a `Person` column is filed under `Person`, not under whatever table the *route* is about (#1175, #1179).
- `BoardSettings.membersGoogleGroupEmail` / `.newsletterGoogleGroupEmail` — the two org-wide list addresses.
- `config.googleDirectoryConfigured()` — integration is OFF unless both the service-account key and the admin subject are set. Same null ⇒ off pattern as Resend and the s-read mirror.

## 2. Core model (carried forward from #1156)

### 2.1 Desired state is a pure function

`computeDesiredState(now)` reads live rosters and memberships and emits the complete "who should be in what" tuple set on every run. It is **not** event-driven and keeps no bookkeeping of its own.

Everything awkward falls out of a plain diff against what was last applied: program-boundary removal, membership lapse, and the youth reason-union need no special-case code. A tuple is `(personId, targetKind, targetRef, scope)`:

| targetKind | targetRef | scope | removal |
|---|---|---|---|
| `google_group` | program group email | `program:<id>` | immediate on boundary |
| `google_group` | members list email | `org` | immediate on boundary |
| `newsletter` | newsletter email | `org` | **never removed** |
| `slack_channel` | channel id | `program:<id>` | warn, then remove after 7 days |

### 2.2 `SyncState` is a cache, not a source of truth

One row per `(personId, targetKind, targetRef, scope)`. It records what was *applied* externally, the last error, retry state, and provenance (`reasons`). Desired state is always recomputed live; the ledger never decides who belongs.

### 2.3 Population rules

Direct sync at **age 13+**, stacking with the existing rule that a synced minor's household leads are synced too. Program leads and core volunteers get the program's group and channel under the same rule.

### 2.4 `ProgramSlackAuth`

Per-program Slack bot tokens live in their own table, never as a column on `Program` — otherwise every `program.findMany()` without an explicit `select` risks pulling a secret into memory. A separate table forces an explicit join.

## 3. Consent and audit — what is new

The engine above is add/remove symmetric and has no opinion about *who* did the removing. That is the gap this section closes.

### 3.1 Every add is audited

Adding a person to a list is a real-world act — their address starts receiving mail. Each successful add writes an `AuditLog` row: actor (the sync's system actor), the target, and the reasons that made it desired.

**Exception: the newsletter is not audited.** It is add-only, low-stakes, and would be the highest-volume audit source in the app for no investigative value.

### 3.2 A self-removal is detected, audited, and permanently respected

If a person removes themselves from a Google group, that is a decision, and the sync must never silently undo it.

**This requires a capability the current design lacks.** The Google client has only `insertMember` and `removeMember` — it cannot *observe*. Reconcile diffs desired state against the ledger, so an external removal is invisible: the row still reads `applied: true`, nothing happens, and the person stays out **by accident**. Any event flipping `applied` back to false — a failed op, an admin reset, a row rebuild — would re-add them and override their choice.

The fix has three parts:

1. **Observe.** Add `listMembers(groupEmail)` and compare actual membership against the ledger's applied rows.
2. **Record.** A row that is `applied && desired` but absent externally is a self-removal: write an `AuditLog` entry and set a sticky marker on the row.
3. **Respect.** The marker suppresses adds for that `(person, target, scope)` **permanently**. Not "until the reason changes" — permanently.

**Decided: the opt-out has no in-app clear path.** Nothing in checkin can reset it. Someone who wants back on a list is re-added on the Google side by hand, and the next reconcile simply observes them present and leaves them alone.

*Consequence worth accepting deliberately:* an accidental unsubscribe is unfixable from inside the app. That is the price of the guarantee that no code path can quietly re-add someone who opted out.

### 3.3 The members list raises an admin follow-up

Leaving the **members list** is different from leaving a program group: it usually means something — a lapsed member, a disputed renewal, someone quietly disengaging. So a self-removal there additionally raises an admin follow-up.

Program-group and newsletter self-removals do **not** raise one.

**Open question — see §6.** Where the follow-up lives is not settled.

### 3.4 Slack, by symmetry

The same principle should hold for Slack: a person who leaves a program channel has made a choice, and the warn-then-remove flow must not fight it by re-inviting them.

Slack differs in two ways worth calling out:

- Leaving a channel is lower-stakes and more casual than unsubscribing from a mailing list. A permanent opt-out may be too strong.
- `conversations.members` gives the same observation capability `listMembers` does for Google, so detection is symmetric and cheap.

**Proposed:** detect and audit Slack self-removals identically, and suppress re-adds for that `(person, channel)`. **Flagged for review** — this extends a decision that was taken about email, and the casualness of Slack cuts against it.

## 4. Data model changes

On `SyncState`:

| field | purpose |
|---|---|
| `selfRemovedAt` | set on detection; suppresses all future adds for this row, permanently |
| `selfRemovedSource` | `google` \| `slack` — which side reported it |

The follow-up marker depends on §6.

No change to `AuditLog`. Entries are filed under `tableName: "SyncState"` with the target in `newData` — the row genuinely is the thing that changed.

## 5. What this does *not* do

- **No reconciliation of Google-side additions.** If an admin adds someone to a group by hand, the sync leaves them alone. It never removes anyone it did not add and does not consider desired.
- **No self-service resubscribe.** By §3.2.
- **No newsletter removal, ever** — including on membership lapse. Unchanged from #1156.

## 6. Open question: where the admin follow-up lives

The intent is to **reuse an existing review queue**. I checked, and none fits:

- **`PaymentException`** is the closest structurally — `kind`/`severity`/`status`, `personId`, `resolvedById`/`resolvedAt`/`resolutionNote`, and idempotent re-detection, which is exactly the shape a nightly detector needs. Two blockers:
  1. Its uniqueness key is `CREATE UNIQUE INDEX ... ON ("kind", "shopifyOrderId")` with no `NULLS NOT DISTINCT`. A sync follow-up has no order id, so `(kind, NULL)` permits unlimited duplicates — **the nightly reconcile would insert a fresh row every run, forever.** The one property that makes the table right is the one that fails.
  2. Its badge counts `status IN ('OPEN','ACKNOWLEDGED')` with no `kind` filter, so the item would surface under **Finance Ops → Payment problems**.
- **`TrustedAdultReview`** is background-check specific (`PENDING_BOARD_REVIEW`, reviewer pairs).
- **`OrgMembershipProcess`** models the membership lifecycle, not exceptions.

So a new table or a field is unavoidable. Two candidates, to settle in review:

**(a) `SyncFollowUp` table** — modelled on `PaymentException`'s proven shape but with a working key (`personId, targetRef, scope`) and its own kind enum. Inherits the badge/ops-tab pattern, keeps sync out of Finance Ops, supports resolve-with-note. Costs a table and a UI surface.

**(b) Field on `SyncState`** (`adminFollowUpAt` / `adminFollowUpDoneAt`) — no new table; the row already exists and is already unique per `(person, target, scope)`, so idempotency is free. No resolution note.

Given §3.2 leaves no in-app way to reverse an opt-out, this flag is the **only** admin-facing trace of a self-removal. If an admin should be able to mark it handled and say what they did, that argues for (a).

## 7. Rollout

| PR | contents | inert? |
|---|---|---|
| 1 | Schema + `lib/sync/**`: desired-state engine, clients incl. `listMembers`/`conversations.members`, ledger | yes — nothing calls it |
| 2 | Detection + audit + opt-out suppression, with tests | yes |
| 3 | Boundary PR: registry entry + scope binding for the sync-status route (isolation rule) | yes |
| 4 | Wire-up: nightly reconcile, ops status view, follow-up surface | **no** — first live behaviour |

Ordering constraint carried from #1157: any `src/security/**` change ships in its own PR (`security-boundary-isolation.yml`).

## 8. Testing

- **Unit** — desired-state is a pure function; assert tuple sets for boundary cases (turning 13, lapse mid-program, lead of a minor, core volunteer).
- **Integration** — detection: a row `applied && desired` absent from `listMembers` produces exactly one audit entry, sets the marker, and **no subsequent reconcile re-adds it**. That last assertion is the whole feature; a test that only checks the first reconcile would pass against a broken implementation.
- **Negative** — newsletter self-removal writes **no** audit row; a program-group self-removal raises **no** follow-up.
- **Integration-off** — every path is a no-op when `googleDirectoryConfigured()` is false.
