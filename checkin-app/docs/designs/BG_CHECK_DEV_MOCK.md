# Background-check dev mock

**Status: SHIPPED.** Verified in tree: `bgMockActive()`/`bgMockActiveEnv` in
`config.ts`, `MockBackgroundCheckProvider` in `background-check/manual-adapter.ts`,
the `/dev/bg-consent` interstitial + `api/dev/bg-consent/complete` route. The
flow mechanics are ground truth in that code; this doc keeps only the reason the
mock exists and the fuse decision.

## The code-independent reason it exists

Averity/VERITY (the background-check vendor) exposes **no API and no dev
sandbox** — only a hosted consent page (a static deep link) and email to a human.
So on a laptop or cloud-dev instance there is no way to *start* a check, meaning
an application can never reach the board's review queue and the two-reviewer
sign-off can't be exercised end-to-end. The mock fills exactly that gap, mirroring
the Zoho Sign (`docs/ops/contract-signing-mock.md`) and Shopify (`SHOPIFY_DEV_STORE_WEBHOOK.md`)
mocks: a provider seam returns a dev interstitial deep link instead of the real
Averity URL; its "Consent (DEV)" button drives the **real** `markBgConsent` →
advance → parallel-review path. Everything below `markBgConsent` — including the
board sign-off at `/membership-ops/review` (two `isBackgroundCheckReviewer`/
`isBoardMember` attestations) — is untouched and identical to prod. The system
never sees a real check, only the consent flag and the attestations, same as prod.

## Fuse (the prod-safety decision)

`bgMockActive()` is true iff **both** hold: `AVERITY_CONSENT_URL` unset (setting
the real link opts back into it) **and** `CHECKIN_ENV !== 'prod'` (fails safe to
prod when unset). One server-only fuse ⇒ no mock path is reachable in prod by
construction. `NODE_ENV !== 'production'` was eliminated as a second fuse in the
#951 review — every deployed instance runs the production image, so it never
distinguished prod from cloud-dev; it only broke dev-instance features.
