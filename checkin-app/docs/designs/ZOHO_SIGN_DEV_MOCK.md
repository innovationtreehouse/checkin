# Zoho Sign — Dev/Local Mock for Membership Contract Signing

**Status: SHIPPED as Option A.** Verified in tree: the provider seam
`contract/zohoProvider.ts` (a `ZohoSignProvider` type with a real adapter and a
`mockProvider`, picked per-call), the dev interstitial `/dev/zoho-sign` + its
server completion route `api/dev/zoho-sign/complete`, and `config.zohoAvailable()`
(= `zohoConfigured() || zoho-mock-active`) all exist. The prod signing path it
wraps — `external.ts › getOrCreateContractSigningUrl`/`markContractSigned`/
`advanceExternalIfComplete`/`syncContractStatus`, `api/webhooks/zoho`
(`verifyZoho`/`parseZohoWebhook`/`findProcessByEnvelope`) — is ground truth for
the mechanics; this doc keeps only the decisions and the rejected options.

**Scope:** the Zoho Sign e-signing seam of the membership EXTERNAL phase. Not S3,
not Shopify (sibling gaps below).

## Why Option A won (the rejected options are tombstones)

The EXTERNAL phase can never reach `PENDING_PAYMENT` in dev because three hard
stops key on unset secrets: the `zohoConfigured()` gate on the Sign action, the
S3 `loadAgreementPdf()` call (Wall 2, see below), and the `zohoConfigured()` gate
on completion-sync. Three shapes were considered:

- **Option A — mock provider selected by env *(chosen)*.** A `ZohoSignProvider`
  interface, a real adapter wrapping today's client, and a `MockZohoSignProvider`
  selected in dev. Mirrors the `BackgroundCheckProvider` pattern already in the
  codebase. **Only option that unblocks the applicant end-to-end** (the Sign
  button works) while keeping every state-machine transition, audit row, and race
  guard identical to prod; the real adapter is a thin pass-through so prod is
  behaviorally unchanged. Cost: an interface + two adapters + the `external.ts`
  call-site rewrite.
- **Option B — inline instant-complete stub (no interface).** Smallest diff, but
  scatters `if (dev)` branches through the real service (the two paths drift) and
  has no single "here's the mock" object — less faithful to the existing provider
  idiom. Rejected.
- **Option C — dev-only "simulate webhook" button.** Leaves `external.ts`
  untouched, so the Sign button still 503s (Wall 1 unaddressed) — not end-to-end.
  Good only as a *complement* for webhook fidelity, weak as the primary. Rejected
  as primary.

## Decisions (resolved with maintainer)

| # | Question | Decision |
|---|----------|----------|
| 1 | Interstitial vs. instant-advance | **Interstitial** — a dev-only "Complete signing (DEV)" / "Decline (DEV)" page stands in for the Zoho ceremony, so there's a visible signing step. |
| 2 | Predicate shape | **Single `config.zohoAvailable()`** replaces the two `zohoConfigured()` gates; the same dev disjunct supplies the dev `ZOHO_WEBHOOK_SECRET`. |
| 3 | Webhook fidelity | **Fire the real webhook** from the interstitial's *server* endpoint, not the sync path — see rationale below. |
| 4 | PDF concession | **Accept the one-line `loadAgreementPdf` bypass** in dev-mock mode (§ below). Full S3 dev-PDF stays a sibling proposal. |
| 5 | `local` vs `dev` parity | **Both** — selected via the dev instance fuse. |
| 6 | Test seam | **Reuse** — the mock provider doubles as the injection seam for membership tests. |

**Why fire the webhook, not the sync path (Q3).** The interstitial's "Complete"
button POSTs to a dev *server* endpoint that synthesizes a `completed` payload and
self-fires the real webhook, because that exercises `verifyZoho`'s timing-safe
compare, `parseZohoWebhook`, `findProcessByEnvelope`, and the `withWebhook`
wrapper — all code the sync path skips. The secret stays server-side (the browser
never sees it). `ZOHO_WEBHOOK_SECRET` is one of the "unset in dev" secrets, so in
mock mode `zohoWebhookSecret()` returns a **hardcoded dev default** — it guards
nothing real (the payload is self-generated) and exists only to give the compare a
value. Idempotency is belt-and-suspenders as in prod: the webhook fires
`markContractSigned`, then the `?signed=1` redirect's `syncContractStatus` fires
it again; the conditional `updateMany` on `contractSignedAt: null` sees `count ≠ 1`
the second time → no double audit row, no double advance.

## Prod safety

`zohoAvailable()` reduces to plain `zohoConfigured()` in prod (the dev disjunct is
false), so prod requires real secrets exactly as before; the mock module is only
ever *selected* behind the server-only fuse (`CHECKIN_ENV`, fails safe to prod,
never `NEXT_PUBLIC_`). The `NODE_ENV !== 'production'` clause was eliminated
repo-wide in the #951 review — every deployed instance runs the production image,
so it never distinguished a misconfigured prod box from cloud-dev. Keep the unit
test asserting the selector returns the real adapter under `CHECKIN_ENV=prod`.

## The S3 PDF coupling (Wall 2) — a required tiny concession

The Zoho mock alone does **not** unblock dev: `getOrCreateContractSigningUrl`
calls `loadAgreementPdf()` (S3) *before* the client, and that 503s in dev too.
Decision: when the mock provider is active, skip the PDF load (the mock
`createRequest` ignores bytes anyway) — a one-line guard, keeping the S3 concern
out of this change. Full S3 dev-PDF is a sibling gap, not solved here.

**Sibling gaps this pattern could later cover (not solved here):** the S3
agreement PDF (`agreementDocument.ts`) and the Shopify `orders/paid` webhook (see
`SHOPIFY_DEV_STORE_WEBHOOK.md`) share the same "dev instance, secret unset, 503"
shape. A shared "dev-mock external provider" convention could cover all three, but
each is its own proposal.

## What the mock does NOT reproduce (accepted gaps)

The only prod code left unexercised in dev is the real Zoho **HTTP + OAuth** (the
five network calls, `ZohoError`/timeout paths, token caching) and the embedded
sign UX / real envelope ids. Everything from webhook receipt through state
transition is the real path.
