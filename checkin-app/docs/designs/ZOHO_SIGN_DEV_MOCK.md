# Zoho Sign — Dev/Local Mock for Membership Contract Signing

**Status:** Proposal (design only — no implementation). Direction chosen — see §7.
**Scope:** Zoho Sign e-signing seam of the membership EXTERNAL phase. Not S3, not Shopify (noted as sibling gaps in §6).
**Audience:** maintainer review before any code is written.

**Decisions locked (maintainer, this round):** Option A (provider seam) · skip PDF load when mock active · interstitial page (not instant-bounce) · single `zohoAvailable()` predicate · mock active on both `dev` and `local` · the mock doubles as the test seam · **the interstitial fires the real webhook path in dev** (Q3 resolved — see §4a & §7).

---

## 1. Current flow — how a contract gets signed today

The EXTERNAL phase (`PENDING_EXTERNAL_ACTION`) gates on two things: contract signed **and** background check handled. This proposal only touches the contract half. Once `contractSignedAt` is set **and** a BG condition holds, `advanceExternalIfComplete` flips the process to `PENDING_PAYMENT`.

### 1a. Send-for-signature (applicant clicks "Sign")

`POST /api/membership/contract/sign` → `getOrCreateContractSigningUrl(userId)` (`src/lib/membership/external.ts`):

1. **Gate:** `if (!config.zohoConfigured()) throw ExternalError("not_configured")` → route maps to **503**. *(Wall 1.)*
2. Resolve the applicant's in-flight process (latest `PENDING_EXTERNAL_ACTION`), assert lead/sysadmin.
3. `getAccessToken()` — OAuth refresh-token exchange against Zoho (`requireSecrets()` throws if any secret unset).
4. If no stored `zohoEnvelopeId`/`zohoActionId` yet:
   - `loadAgreementPdf()` — fetch the agreement PDF from S3. **Also 503s in dev** (`AGREEMENT_PDF_S3_BUCKET` unset → `AgreementUnavailableError` → `agreement_unavailable`). *(Wall 2 — see §5.)*
   - Non-prod: `stampWatermark(pdf, "DEV TEST — NOT A LEGAL AGREEMENT")` and prefix the request name `[DEV TEST — NOT BINDING]`.
   - `createRequest(...)` → upload PDF + register the single embedded SIGN recipient → `{ requestId, actionId, documentId }`.
   - `submitRequest(...)` → attach signature fields.
   - Atomically claim the process for these ids (`updateMany` on `zohoEnvelopeId/zohoActionId` null) — loser discards its orphaned Zoho request; writes a `zohoEnvelopeId`+`zohoActionId` audit row (actor = applicant).
5. `getEmbeddedSignUrl(...)` — mint a short-lived embedded signing URL. Returned to the client, which redirects the applicant into the in-app Zoho ceremony.

### 1b. Completion — three ways `contractSignedAt` gets set

All three funnel through `markContractSigned(processId, actorId=0)` → conditional `updateMany` on `contractSignedAt: null` (idempotent, single audit row) → `advanceExternalIfComplete`.

- **Return-sync (primary):** Zoho `redirect_pages` bounce the finished signer to `/membership?signed=1`. The page calls `POST /api/membership/contract/sync` → `syncContractStatus(userId)`, which — **gated on `config.zohoConfigured()`** (Wall 3) — calls `getRequestStatus(token, envelopeId)`; if completed, `markContractSigned(process.id, userId)`. This is the reliable path (doesn't depend on a scale-to-zero instance being awake).
- **Webhook (backstop):** `POST /api/webhooks/zoho` → `verifyZoho` requires `ZOHO_WEBHOOK_SECRET` (else 500), timing-safe token compare (else 401) → `parseZohoWebhook` → `findProcessByEnvelope` → `markContractSigned(mp.id)` with `SYSTEM_ACTOR = 0`.
- **Manual board mark:** a board member records the contract signed (also routes through `markContractSigned`).

### 1c. Where dev dies

Three hard stops, all keyed on unset secrets:

| Wall | Location | Symptom in dev |
|------|----------|----------------|
| 1 | `getOrCreateContractSigningUrl` `!zohoConfigured()` | Sign button → 503 "check back soon" |
| 2 | `loadAgreementPdf()` (S3) | even past Wall 1, `agreement_unavailable` 503 |
| 3 | `syncContractStatus` `!zohoConfigured()` guard | completion never syncs on return |

The webhook path is also dead (no `ZOHO_WEBHOOK_SECRET`), but it's a backstop, not the primary. **An applicant in dev can never reach `PENDING_PAYMENT`.**

---

## 2. Options

### Option A — Mock Zoho client provider selected by CHECKIN_ENV *(recommended)*

Mirror the `BackgroundCheckProvider` pattern (`background-check/provider.ts` + `manual-adapter.ts`): a `ZohoSignProvider` interface with the five client functions (`getAccessToken`, `createRequest`, `submitRequest`, `getEmbeddedSignUrl`, `getRequestStatus`), a real adapter wrapping today's `zohoClient.ts`, and a `MockZohoSignProvider` selected when `isDevInstance() && NODE_ENV !== 'production'`.

Mock behavior:
- `getAccessToken()` → `"dev-mock-token"`.
- `createRequest()` → synthetic ids (`dev-req-<processId>`, `dev-act-…`, `dev-doc-…`); ignores the PDF bytes.
- `submitRequest()` → no-op.
- `getEmbeddedSignUrl()` → returns the URL of a **dev interstitial page** (§4a), not `?signed=1` directly, so there's a visible signing step.
- `getRequestStatus()` → `true`.

`external.ts` calls the provider instead of importing `zohoClient` functions directly. The two `zohoConfigured()` gates (Walls 1 & 3) change to a new predicate `config.zohoAvailable()` = `zohoConfigured() || (isDevInstance() && NODE_ENV !== 'production')`. The same dev disjunct also supplies a **dev default `ZOHO_WEBHOOK_SECRET`** so the interstitial can fire the real webhook (§4a) — `zohoWebhookSecret()` returns the dev default in mock mode, its real env value otherwise.

**Tradeoffs.** State machine runs **identically** to prod (real `markContractSigned` → `advanceExternalIfComplete` → audit → `PENDING_PAYMENT`). One clean seam, matches an existing codebase pattern, prod path untouched (real adapter is a thin pass-through). Cost: introduces an interface + two adapters + call-site rewrite in `external.ts`; still needs the Wall-2 PDF bypass (§5).

### Option B — Inline instant-complete stub (no provider interface)

Skip the interface. In `external.ts`, branch on a dev predicate: when dev-mock, short-circuit — skip `getAccessToken`/`createRequest`/`submitRequest`, stamp synthetic ids straight onto the process, and return `/membership?signed=1`. `syncContractStatus` similarly short-circuits to `markContractSigned`.

**Tradeoffs.** Smallest diff, no new files. But scatters `if (dev)` branches through the real service (harder to keep the two paths from diverging), and there's no single "here's the mock" object — less faithful to the existing provider idiom. Behaviorally identical to A downstream.

### Option C — Dev-only "simulate webhook" button

Leave `zohoClient` and `external.ts` untouched. Add a dev-only membership-page button → `POST /api/dev/zoho/complete` (guarded `isDevInstance() && NODE_ENV !== 'production'`) that calls `markContractSigned(processId, SYSTEM_ACTOR)` directly, or replays a signed payload against the webhook with a dev secret.

**Tradeoffs.** Zero change to the send-for-signature path — but that means the Sign button still 503s (Wall 1 unaddressed), so the applicant flow isn't end-to-end; you'd click a separate "mark signed" affordance. Exercises the completion transition and (webhook variant) token verification, but not `createRequest`/embed. Good as a **complement** for webhook fidelity (see §6 open questions), weak as the primary.

### Recommendation

**Option A.** It's the only option that unblocks the applicant end-to-end (Sign button works) while keeping every state-machine transition, audit row, and race guard identical to prod, and it reuses the provider pattern already established for background checks. The real adapter stays a pass-through so prod is behaviorally unchanged. Pair with the Wall-2 PDF bypass in §5.

---

## 3. Prod safety — mock dead by construction

Selection uses the same idiom as persona-mint (`auth-options.ts:104`):

```
isDevInstance() && process.env.NODE_ENV !== 'production'
```

Two independent conditions, both server-only:
- `CHECKIN_ENV` fails safe to `prod` for any unrecognized/unset value (`readCheckinEnv`), and is **not** `NEXT_PUBLIC_` — never in the client bundle.
- `NODE_ENV !== 'production'` is a second, build-level fuse.

`zohoAvailable()` reduces to plain `zohoConfigured()` in prod (the dev disjunct is false), so prod requires real secrets exactly as today. The mock provider module is only ever *selected* behind that guard; the real adapter is the default export otherwise. No mock code path is reachable in prod. Recommend a unit test asserting the selector returns the real adapter when `CHECKIN_ENV=prod` and when `NODE_ENV=production`.

---

## 4a. The interstitial and the webhook (Q3 resolved)

The mock's `getEmbeddedSignUrl` returns a **dev-only interstitial page** (guarded `isDevInstance() && NODE_ENV !== 'production'`) that stands in for the Zoho signing ceremony: a page labelled "DEV — NOT A LEGAL AGREEMENT" with two buttons — **"Complete signing (DEV)"** and **"Decline (DEV)"**.

It is surfaced under a **single left-nav "Debug" item** → `/dev`, a tab section (mirroring `/system-status`) whose tabs are **Email** (the captured-email inbox from EMAIL_DEV_MOCK.md) and **Sign** (this mock). `/dev` redirects to the first tab; the tabs live in `app/dev/layout.tsx` (source of truth `lib/devToolsNav.ts`). Reached with **no `?rid`** (the Sign tab), the page shows a start/resume entry that POSTs the real `/api/membership/contract/sign` action — in mock mode that hands back this same interstitial URL carrying a `rid`, so the tab drops a developer into the flow without re-clicking Sign on the membership page.

**Decline** mirrors Zoho's `sign_declined` redirect: the button simply navigates to `/membership?declined=1` — no server call. There's no "mark declined" transition in prod either (a declined request just never advances; `parseZohoWebhook` only acts on `completed`), so this exercises the `?declined=1` applicant-facing path with zero new backend.

**Complete signing** does **not** shortcut to `?signed=1`. It POSTs to a dev-only **server** endpoint that:
1. Synthesizes a Zoho completion payload — `{ requests: { request_id: <stored zohoEnvelopeId>, request_status: "completed" } }`.
2. Self-fires the **real** webhook path (`verifyZoho` → `parseZohoWebhook` → `findProcessByEnvelope` → `markContractSigned`), signing with a dev `ZOHO_WEBHOOK_SECRET`.
3. Redirects the browser to `/membership?signed=1`.

**Why fire the webhook instead of the sync path** (the original draft used sync):
- It exercises the real `verifyZohoToken` timing-safe compare, `parseZohoWebhook` payload parsing, `findProcessByEnvelope` match, and the `withWebhook` wrapper — code the sync path skips entirely.
- The secret stays **server-side** (the endpoint signs; the browser never sees `ZOHO_WEBHOOK_SECRET`).
- The webhook gate needs `ZOHO_WEBHOOK_SECRET` — one of the "unset in dev" secrets — so in mock mode `zohoWebhookSecret()` returns a **hardcoded dev default** (see §2 predicate). No env setup, can't-be-forgotten, and it guards nothing real: the payload is self-generated locally, so the secret exists only to give `verifyZohoToken`'s real compare a value. Prod is unaffected (dev disjunct is false → real env value required).

**Idempotency (belt-and-suspenders, same as prod):** the webhook fires `markContractSigned`; then the `?signed=1` redirect triggers `syncContractStatus`, which calls `markContractSigned` again; the conditional `updateMany` on `contractSignedAt: null` sees `count !== 1` the second time → no double audit row, no double advance. Both completion paths coexist exactly as they do against real Zoho.

**Net:** the only prod code left unexercised in dev is the real Zoho **HTTP + OAuth** (`getAccessToken`/`createRequest`/`submitRequest`/`getEmbeddedSignUrl`/`getRequestStatus` network calls) — everything from webhook receipt through state transition is the real path.

---

## 4. Fidelity — what the mock does and doesn't reproduce

**Reproduces (identical to prod):**
- The full state transition: `PENDING_EXTERNAL_ACTION` → (contract signed via `markContractSigned`) → `advanceExternalIfComplete` → `PENDING_PAYMENT`.
- `SYSTEM_ACTOR = 0` audit-log rows, idempotent conditional `updateMany` guards, reviewer notification on advance.
- The applicant round-trip shape: click Sign → redirect → interstitial "Complete signing (DEV)" → back to `/membership?signed=1`.
- **The inbound webhook path** — `verifyZohoToken` (real timing-safe compare against the dev secret), `parseZohoWebhook`, `findProcessByEnvelope`, `withWebhook` (§4a).
- Both completion paths coexisting (webhook + `?signed=1` sync) with idempotent single-write semantics.
- The "not binding" framing — no real signature is ever produced; interstitial + request name carry the DEV/NOT-BINDING labelling.

**Does NOT reproduce:**
- **Embedded sign UX** — no real Zoho signing ceremony; the interstitial stands in for it.
- **Real Zoho HTTP + OAuth** — `getAccessToken`/`createRequest`/`submitRequest`/`getEmbeddedSignUrl`/`getRequestStatus` network calls, `ZohoError`/timeout paths, token caching, the 20s fetch deadline.
- **Real envelope/action ids** — synthetic `dev-*` strings; no real Zoho request exists.

The design deliberately keeps the mock *below* `markContractSigned` and *routes completion through the real webhook*, so the transition logic **and** webhook-receipt logic that tests and workflows care about are the real thing.

---

## 5. Scope note — the S3 PDF coupling (Wall 2)

The Zoho mock alone does **not** unblock dev: `getOrCreateContractSigningUrl` calls `loadAgreementPdf()` (S3) *before* the client, and that 503s in dev too. Two honest options, both minimal:

- **(preferred)** When the mock provider is active, skip the PDF load — the mock `createRequest` ignores bytes anyway. A one-line guard around the `loadAgreementPdf()` call (pass an empty/placeholder buffer in dev-mock mode) keeps the S3 concern out of this change.
- Or solve the S3 PDF separately (a dev placeholder PDF) — that's the sibling gap below, out of scope here.

This is called out so the maintainer knows the Zoho mock needs a **tiny** PDF-path concession to actually reach `PENDING_PAYMENT`; it does not require solving S3.

**Sibling gaps this pattern could later cover (not solved here):**
- **S3 agreement PDF** (`agreementDocument.ts`) — same "dev instance, secret unset, 503" shape; a dev placeholder PDF provider.
- **Shopify orders/paid webhook** — the `PENDING_PAYMENT` → paid transition has the same external-dependency-in-dev problem.

A shared "dev-mock external provider" convention could eventually cover all three, but each is its own proposal.

---

## 6. Decisions (resolved with maintainer)

| # | Question | Decision |
|---|----------|----------|
| 1 | Interstitial vs. instant-advance | **Interstitial** — dev-only "Complete signing (DEV)" page (§4a). |
| 2 | Predicate shape | **Single `config.zohoAvailable()`** = `zohoConfigured() \|\| dev-mock`; swap the two gates. Same disjunct supplies the dev `ZOHO_WEBHOOK_SECRET`. |
| 3 | Webhook fidelity | **Fire the real webhook** from the interstitial's server endpoint (§4a) — not the sync path. Exercises `verifyZohoToken`/parse/match. |
| 4 | PDF concession | **Accept the one-line `loadAgreementPdf` bypass** in dev-mock mode (§5). Full S3 dev-PDF stays a sibling proposal. |
| 5 | `local` vs `dev` parity | **Both** — selected via `isDevInstance()` (dev + local). |
| 6 | Test seam | **Reuse** — the mock provider doubles as the injection seam for membership tests. |

### Remaining open items
- None blocking. Dev webhook secret = **hardcoded dev default** in `config.zohoWebhookSecret()` (no env, guards nothing real in dev; prod uses the real env value). Interstitial ships **both** "Complete signing (DEV)" and "Decline (DEV)".

---

## 7. Chosen direction (summary for the implementer)

1. **`ZohoSignProvider` interface** (5 methods) + `RealZohoSignProvider` (thin wrapper over today's `zohoClient.ts`, prod-unchanged) + `MockZohoSignProvider`. Select the mock only under `isDevInstance() && NODE_ENV !== 'production'`; real adapter otherwise.
2. **`external.ts`** calls the provider, not `zohoClient` directly. When the mock is active, **skip `loadAgreementPdf()`** (pass a placeholder buffer — the mock ignores bytes).
3. **`config.zohoAvailable()`** replaces the two `zohoConfigured()` gates (Walls 1 & 3). In mock mode `zohoWebhookSecret()` returns a **hardcoded dev default**; prod uses the real env value.
4. **Interstitial page** (dev-only) is the mock's `getEmbeddedSignUrl` target, with two buttons: **"Complete signing (DEV)"** POSTs a dev-only **server** endpoint that synthesizes the Zoho completion payload and **fires the real webhook path**, then redirects to `?signed=1`; **"Decline (DEV)"** just navigates to `?declined=1` (no endpoint — mirrors prod's `sign_declined`).
5. **Mock doubles as the test seam** for membership state-machine tests.
6. Prod safety: mock, PDF-skip, dev webhook secret, and interstitial route are all behind `isDevInstance() && NODE_ENV !== 'production'`; `zohoAvailable()`/`zohoWebhookSecret()` collapse to their real values in prod. Add a selector unit test asserting the real adapter + real secret under `CHECKIN_ENV=prod` and `NODE_ENV=production`.

**Left unmocked by design:** real Zoho HTTP + OAuth only. Everything from webhook receipt → state transition is real code.
