# Background-check dev mock

Averity/VERITY (the background-check vendor) exposes **no API and no dev sandbox** —
only a hosted consent page (a static deep link) and email to a human. So on a
developer laptop or cloud dev instance there is no way to *start* a check, which means
an application can never reach the board's review queue and the two-reviewer sign-off
can't be exercised end-to-end. This mock fills that gap. Mirrors the Zoho Sign
(`ZOHO_SIGN_DEV_MOCK.md`) and Shopify (`SHOPIFY_DEV_STORE_WEBHOOK.md`) mocks.

## Fuse

`config.bgMockActive()` is true iff **all** hold (see `bgMockActiveEnv` in `lib/config.ts`):

- `AVERITY_CONSENT_URL` unset — setting the real link opts back into it,
- `CHECKIN_ENV !== 'prod'` (fails safe to prod when unset).

One server-only fuse ⇒ no mock path is reachable in prod by construction.
(`NODE_ENV !== 'production'` was eliminated as a second fuse in the #951 review:
every deployed instance runs the production image, so it never distinguished
prod from cloud-dev — it only broke dev-instance features.)

## Flow

1. **Provider seam** — `backgroundCheckProvider.getConsentDeepLink()`
   (`background-check/manual-adapter.ts`) selects per-call: the real `ManualBackgroundCheckProvider`
   (returns `AVERITY_CONSENT_URL`) normally, `MockBackgroundCheckProvider` (returns
   `${baseUrl}/dev/bg-consent`) when the mock is active. The applicant's "Consent on
   Averity →" button on `/membership` points at whichever it returns.
2. **Interstitial** — `/dev/bg-consent` (404s unless `bgMockActive`) stands in for Averity's
   hosted consent page. Its "Consent (DEV)" button POSTs `/api/dev/bg-consent/complete`.
3. **Complete route** — resolves the caller's own in-flight `PENDING_EXTERNAL_ACTION` process
   (`latestPendingExternal`) and calls the real `markBgConsent`, driving the same
   advance → `PENDING_PAYMENT` → parallel-review → `notifyReviewers` path prod does.
   Everything below `markBgConsent` is real and identical to prod.
4. **Board sign-off** — unchanged: two eligible reviewers (`isBackgroundCheckReviewer`
   or `isBoardMember`) attest at `/membership-ops/review` (`review.ts › attest`). Two
   APPROVE clears the check; any REJECT blocks. The mock touches nothing here.

The system never sees a real check — only the consent flag and the attestations, same
as prod.
