# Email Templates — deploy-free email content

**Status:** design, not built.
**Goal:** change any email's subject/body *without* a code change or deploy, and make it
structurally impossible to ship an email that bypasses the shared template + branding.

## Problem (as it stands today)

- **The shared layout is used by 3 of ~20 flows.** `baseEmailLayout` wraps only checkin,
  household, and post-event. Everything else (`membership/*`, `trusted-adult/*`, scholarship,
  shopify-error, cron warnings, `notifications.ts`) assembles `<p>...</p>` by hand at each
  call site with no branded shell. A new flow has to *remember* to use the wrapper — nothing
  enforces it, so drift is the default.
- **Subjects and body copy are hardcoded in `.ts` files.** Rewording "Welcome to Treehouse"
  is a code edit, PR, and deploy.
- **Two deploy-free systems already exist** and prove the pattern works here:
  - **Outreach** — subject/body in `BoardSettings`, `{{token}}` substitution
    (`src/lib/outreach/`), edited at `settings/outreach`.
  - **Scholarship ACK** — subject/body in `BoardSettings`, edited at `settings/email`
    (`scholarshipAckCopy.ts`, `renderAckBody`).

This design **generalizes those two into one system** that every email goes through.

## Design

### 1. Storage — `EmailTemplate` table

One row per email type, keyed by a stable string `key`:

| column      | notes                                                   |
|-------------|---------------------------------------------------------|
| `key`       | unique, e.g. `membership.congrats` (see registry below) |
| `subject`   | token string                                            |
| `body`      | **plain text**; blank line = paragraph                  |
| `updatedBy` | Person id, audit                                        |
| `updatedAt` | audit                                                   |

Editing a row changes the live email — **no deploy**. Single global set (no multi-tenant, no
per-board override — confirmed out of scope).

### 2. Body is plain-text-with-tokens, never raw HTML

Editors (board members) write plain text. `blank line = new paragraph`. The HTML shell,
branding, and links come from code, not the editor. This is exactly today's `renderAckBody`
contract, and it is the whole XSS/broken-markup safety story: **there is no HTML-authoring
surface**, so a non-dev editor cannot inject markup or break the layout. (See the sandboxed
`<iframe>` preview history noted in `scholarshipAckCopy.ts` — this design avoids that class of
problem by construction.)

### 3. Token registry — `src/lib/email-templates/registry.ts`

The registry is the **only** per-key code. It does not hold copy (copy is in the DB); it holds
the *contract* for each key:

```ts
type TokenKind = "text" | "link";
interface TokenSpec { kind: TokenKind; label?: string } // label: anchor text for link tokens
interface TemplateSpec {
  allowedTokens: Record<string, TokenSpec>;
  sampleCtx: Record<string, string>;   // powers the admin preview
  defaultSubject: string;              // seed + never-blank fallback
  defaultBody: string;                 // seed + never-blank fallback
}
export const REGISTRY: Record<string, TemplateSpec> = { ... }
```

- `text` tokens are **HTML-escaped** and inserted as text.
- `link` tokens render as `<a href="{value}">{label}</a>` — the URL is a system value in the
  send `ctx`, the anchor label lives in the registry. The editor places `{{actionLink}}` in the
  body; they never type a URL or an `<a>`. (Open sub-decision D-2 below: label in registry vs DB.)
- Save-time validation rejects any `{{token}}` not in the key's `allowedTokens`
  (generalizes the existing `findUnknownTokens`).

### 4. Render + send — one door, `sendTemplated`

```
sendTemplated(key, to, ctx) →
  row   = EmailTemplate[key]  ?? REGISTRY[key].{defaultSubject,defaultBody}   // never blank
  subj  = substitute(row.subject, ctx, REGISTRY[key])                         // escaped text tokens
  body  = substitute(row.body, ctx, REGISTRY[key]) → split blank lines → <p>  // generalize renderAckBody
  html  = baseEmailLayout(body)                                               // branding for free
  sendEmail(to, subj, html)                                                   // existing choke-point
```

`substituteTokens` / `findUnknownTokens` change from a **fixed 4-token global switch** to
**registry-driven per-key** substitution over a `Record<string,string>` ctx. Both existing
consumers (outreach server render + `settings/outreach` client preview, and the scholarship
preview) are updated to the new signature as part of the sweep (see §7).

### 5. Enforcement — the template is the only path

- `sendTemplated` is the public API. The raw-HTML `sendEmail(to, subject, html)` becomes
  internal to `email.ts` + the renderer.
- **One grep-to-zero test** asserts no `sendEmail(` call exists outside `email.ts` and the
  renderer. A new flow physically cannot ship inline copy — it won't pass CI.

### 6. Never-blank guarantee — seeds are today's copy

- The migration seeds every `key` with the **exact current** subject/body.
- `sendTemplated` falls back to the registry default if a row is missing or blank.
- Result: the sweep is **copy-neutral** — no email's wording changes. Editing is an override,
  not a requirement.

### 7. The sweep — one conversion, no partial state

Migrate all ~27 flows to `sendTemplated` in a single pass. Because seeds == current copy, the
diff is behavior-neutral on wording. The old inline builders and hardcoded subjects are
**deleted**, not left beside the new path. Folds the two existing deploy-free systems in too
(see D). After the sweep there is exactly one way to send mail.

### 8. Admin UI — new Settings tab, board-gated

- New top tab **"Email Templates"** in `SettingsTabs` (`src/components/admin/SettingsTabs.tsx`),
  route `src/app/settings/templates/page.tsx`. The `settings` layout already admits
  board + sysadmin; the page self-gates `useRequireRole(["isSysadmin","isBoardMember"])`
  like its siblings.
- List keys (grouped by prefix) → edit subject + body → **live preview** rendered from
  `sampleCtx` (client-side, reusing the shared substitute fn so preview can't drift from send)
  → save (token-validated) → optional **send-to-self** (reuse the outreach test-send pattern).

## Key list (27)

Grouped by prefix. `link` tokens noted; everything else is `text`.

### checkin (attendance) — 2
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `checkin.receipt` | `sendCheckinNotifications` participant (`checkinReceiptTemplate`) | participant | name, action, date, time |
| `checkin.householdMember` | `sendCheckinNotifications` household leads (`householdMemberTemplate`) | household lead | leadName, memberName, action, date, time |

> Resolved (flag A): `sendNotification` CHECKIN/CHECKOUT is **dead** — test-only, no prod
> caller. The live check-in mail is the two rows above. No `checkin.notify`/`checkout.notify`
> keys. No separate `checkin.leadAlert` — the lead notice *is* `checkin.householdMember`.

### notifications — 3
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `enrollment.confirm` | `sendNotification` PROGRAM_ENROLLMENT (`participants/route.ts:148`) | family | name, programName |
| `program.assignment` | `sendNotification` PROGRAM_ASSIGNMENT (`programs/route.ts:241`) | lead mentor | name, programName |
| `program.announced` | `notifyNewProgramAnnounced` | families | name, programName, `actionLink` |

> Latent bug fixed by this work: `PROGRAM_ASSIGNMENT` currently falls through
> `sendNotification`'s `switch` to the `default` branch and ships the literal body
> `"System Action: PROGRAM_ASSIGNMENT"`. Giving it a real `program.assignment` template
> replaces that garbage with proper copy.

### post-event — 1
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `event.postEvent` | `postEventTemplate` | attendees | eventName, `actionLink` |

### membership — 3
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `membership.reviewNeeded` | `notifyReviewers` | review team | applicantName, `actionLink` |
| `membership.paymentOpen` | `notifyPaymentOpen` | family | `actionLink`, deadline |
| `membership.congrats` | `sendCongrats` | family | householdName, `actionLink` |

### board — 3
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `board.paidReject` | `notifyBoardPaidReject` | board | processId, `actionLink` |
| `board.paymentException` | `notifyBoardPaymentException` | board | kind, **blurb**, exceptionId, `actionLink` |
| `board.pendingDigest` | pending-participants digest | board | listItems, `actionLink` |

> See flag B (blurb) below.

### participant — 1
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `participant.pendingWarning` | pending-participants warning | family | participantName, deadline |

### shopify — 1
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `shopify.error` | `reportShopifyFailure` | board/sysadmin | errorDetail, `actionLink` |

### trustedAdult — 7 (flag C, fully spelled out — no "resolve at build")
| key | trigger (`service.ts`) | recipient | tokens |
|-----|------------------------|-----------|--------|
| `trustedAdult.boardReview` | `notifyBoard` :580 | board | `actionLink` |
| `trustedAdult.requestInfo` | REQUEST_INFO :421 | family | note, `actionLink` |
| `trustedAdult.deniedRevoked` | DENY + `revokePriorApprovals` :429 | family | adultName, `actionLink` |
| `trustedAdult.changeNotApproved` | DENY, prior approval survives :442 | family | adultName, until, `actionLink` |
| `trustedAdult.notApproved` | DENY, nothing survives :448 | family | adultName, `actionLink` |
| `trustedAdult.overrideDecided` | `overrideReview` deny/revoke :521 | family | adultName, action, `actionLink` |
| `trustedAdult.expiring` | `runExpirySweep` :545 | family | deadline, `actionLink` |

> `deniedRevoked` (:429, from the normal decide path) and `overrideDecided` (:521, from the
> sysadmin override path) share a subject but keep **separate keys** — different code paths,
> different bodies (`overrideDecided` carries an `{{action}}` = denied/revoked token). Deliberately
> not merged: collapsing them is exactly the "resolve at build" shortcut we're avoiding.
> The static `<a>View your trusted adults</a>` footer that `notifyHouseholdFamily` appends
> today becomes the `{{actionLink}}` token in each family template.

### scholarship — 4 (flag D: folded in from `BoardSettings`)
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `scholarship.membershipReview` | membership request-payment-plan | review team | applicantName, `actionLink` |
| `scholarship.programReview` | program request-payment-plan | review team | applicantName, programName, `actionLink` |
| `scholarship.ackMembership` | `sendScholarshipAck` membership (was `DEFAULT_ACK_MEMBERSHIP_BODY`) | family | — |
| `scholarship.ackProgram` | `sendScholarshipAck` program (was `DEFAULT_ACK_PROGRAM_BODY`) | family | programName |

> Fold detail: the ACK copy currently lives in `BoardSettings.scholarshipAck{Subject,Membership
> Body,ProgramBody}` and is edited on `settings/email`. The sweep migrates those values into the
> two `scholarship.ack*` rows, moves editing to the new tab, and removes the three
> `BoardSettings` columns + their controls from `settings/email` (that page keeps only sender
> identity). The `scholarship.ackProgram` subject == `scholarship.ackMembership` subject at seed
> time; each row owns its own subject field going forward.

### outreach — 2 (flag D: folded in from `BoardSettings`)
| key | trigger | recipient | tokens |
|-----|---------|-----------|--------|
| `outreach.opening` | outreach batch opening (was `outreachOpening{Subject,Body}`) | prospects | name, deadline, actionWord, `actionLink` |
| `outreach.reminder` | outreach reminder (was `outreachReminder{Subject,Body}`) | prospects | name, deadline, actionWord, `actionLink` |

> Fold detail: outreach carries extra machinery the transactional flows don't — join/renew
> **variants**, a conditional **unsubscribe footer** appended after substitution, and a
> boundary-derived `{{deadline}}`. That render *wrapper* (`renderOutreachEmail`) stays; only the
> **source of subject/body** moves from `BoardSettings` columns to the two `outreach.*` rows.
> The unsubscribe footer and variant `actionWord` remain outreach-specific ctx, not editor-facing
> copy. `settings/outreach` either redirects into the new tab or is retired; its sandboxed-iframe
> preview is superseded by the plain-text preview (no HTML authoring → no iframe needed).

## Open sub-decisions

**B — `board.paymentException` blurb (11 `kind`→sentence variants).**
The reconciler maps 11 exception kinds to a one-line human description
(`PAID_WHILE_BLOCKED → "a household paid but its application is blocked…"`, etc.). Two ways:

- **B-1 (recommended): `{{blurb}}` token, blurbs stay in the registry (code).** One
  `board.paymentException` row; the editable copy is the wrapper sentence around `{{blurb}}`.
  The 11 blurbs are technical reconciliation-failure labels, not board-tuned marketing copy —
  keeping them in code is honest about what they are, and the board rarely needs to touch them.
  Cost: those 11 strings are *not* deploy-free.
- **B-2: 11 keys** (`board.paymentException.PAID_WHILE_BLOCKED`, …). Every blurb becomes
  board-editable, fully deploy-free, no `{{blurb}}` token. Cost: 11 near-identical rows for one
  flow (11 extra seeds + 11 list entries in the admin UI).

Recommendation **B-1** — the goal is deploy-free *content*, and these are enum diagnostics, not
content. Flag if you want the board to own all 11 → then B-2.

**D-2 — link anchor label: registry (code) or DB?**
Link tokens render as `<a href="{url}">{label}</a>`. The URL is a runtime ctx value; the
**label** ("Review application", "Open payment problems", "View your trusted adults") is fixed
per key. Putting the label in the registry keeps it out of the editor's hands (they can't
mislabel a link), but the label text is then *not* deploy-free. Alternative: add the label as a
third editable field on the row. Recommendation: **label in registry** — it's tied to the
destination, and a mislabeled link is a support problem; revisit if the board asks to edit link
text.

**Layout wrap-all — visual (not copy) change for ~17 flows.**
Today ~17 flows send bare `<p>` with **no** `baseEmailLayout`. Routing everything through
`sendTemplated` wraps them all in the branded shell. Copy is unchanged, but the *visual shell*
gains a header/footer for those flows. This is the point (uniform branding is a stated goal),
but it is not a zero-visual-change sweep. Recommendation: **wrap all** — inconsistent branding
is one of the risks this work exists to kill. Flag if any flow must stay bare.

## Build order (when approved)

1. `EmailTemplate` model + migration (RENAME-safe; seed all 27 keys from current copy).
2. `registry.ts` (27 specs) + generalize `substituteTokens`/`findUnknownTokens` to per-key.
3. `sendTemplated` + generalized `renderAckBody`-style body→`<p>` + `baseEmailLayout` wrap.
4. Sweep all call sites to `sendTemplated`; delete inline builders + hardcoded subjects.
5. Fold outreach + scholarship: migrate `BoardSettings` copy → rows, update render wrappers +
   both preview consumers, drop the moved `BoardSettings` columns + old controls.
6. Grep-to-zero enforcement test (`sendEmail(` only in `email.ts` + renderer).
7. Admin tab: `settings/templates` page + API route (list/get/save + validate + send-to-self),
   add `"templates"` to `SettingsTabs`.

## Explicitly out of scope

Multi-tenant / per-board overrides · rich HTML or markdown bodies · editor-authored links/URLs ·
scheduling/queuing changes (uses the existing `runPaced`/`sendEmail` path).
