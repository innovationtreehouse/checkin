# Shopify Dev-Store Webhook — Implementation Plan

**Status:** Partially executed — Phase 0 (mock) landed via #730; the Phase-3 registration script shipped in #740 (built ahead of O2, see Phase 3). Store setup (Phases 1–2), registration (Phase 3), and secret wiring (Phase 4) remain ops work.
**Companion:** [`SHOPIFY_DEV_STORE_WEBHOOK.md`](./SHOPIFY_DEV_STORE_WEBHOOK.md) (design/rationale).
**Fallback mock:** landed on `main` via #730 (in-process orders/paid mock).

---

## TL;DR — most of the "real" code already exists

The prod path is **already built and correct**. Verified in `src/`:

| Piece | Location | State |
|-------|----------|-------|
| Inbound route | [`api/webhooks/shopify/route.ts`](../../src/app/api/webhooks/shopify/route.ts) | done, prod-correct |
| HMAC verify (timing-safe, raw bytes) | `verifyShopifyHmac` in same file | done — **path-agnostic** |
| Rate-limit → verify → parse → handler wrapper | [`webhookAuth.ts`](../../src/lib/webhookAuth.ts) `withWebhook` | done |
| Env getters (`shopifyStoreDomain/ClientId/ClientSecret/WebhookSecret`) | [`config.ts`](../../src/lib/config.ts) | done |
| Mock-vs-real switch (`shopifyMockActive()`) | `config.ts` (mock commit) | done — auto-off when real creds set |

**No new prod route. No touching verify. No new config getters.** Making it "real" = store setup + secret wiring + (maybe) one small registration script.

There is **no webhook-registration code anywhere in `src/`** (`grep webhooks.json` → 0 hits). Prod's `orders/paid` subscription was **registered by hand** in the store admin → so prod uses the **store webhook signing secret** path, pasted into `SHOPIFY_WEBHOOK_SECRET`. Mirror that.

---

## Phase 0 — land the mock (prereq) — ✅ done
Landed on `main` via #730 (with follow-up fixes; the original `claude/wonderful-tesla-621492` branch is superseded — don't merge it). Its `shopifyMockActive()` gate is the entire mock↔real switch. Setting real creds opts an instance out of the mock automatically — no branch. Nothing left to build.

## Phase 1 — stand up ONE shared dev store (ops)
**Hard blocker: O1 — do we own a Shopify Partner org?** Needs an owner before anything below.
1. Partner Dashboard → create dev store `treehouse-checkin-dev`.
2. **Develop apps → create custom app.** Admin API scopes: `read/write_products`, `read/write_orders`, `read/write_inventory`, `read/write_discounts`. (No Storefront scopes — checkout is a hosted cart permalink. **No OAuth redirect URL** — Client Credentials Grant is server-to-server.)
3. **Install app** to the store (install is what makes the token grant work).
4. Create product "Treehouse Membership" + variant(s) + volunteer discount code. Record variant ids.

## Phase 2 — get the four values
| Env var | Where in Shopify | Notes |
|---------|------------------|-------|
| `SHOPIFY_STORE_DOMAIN` | Settings → Domains (the `*.myshopify.com`) | raw myshopify domain, not a pretty domain |
| `SHOPIFY_CLIENT_ID` | app → API credentials | shown directly |
| `SHOPIFY_CLIENT_SECRET` | app → API credentials | reveal-once, copy now |
| `SHOPIFY_WEBHOOK_SECRET` | Settings → Notifications → Webhooks (bottom of page: "signed with…") | store-admin path, matches prod. **If the subscription was created via the Phase-3 script instead, use the app client secret** — Shopify signs API-created subscriptions with it, not the store signing secret |

Verify token before trusting creds:
```
curl -X POST https://{STORE_DOMAIN}/admin/oauth/access_token \
  -d grant_type=client_credentials -d client_id={ID} -d client_secret={SECRET}
```
200 + `access_token` = good. 401 = wrong creds or app not installed.

## Phase 3 — register the `orders/paid` subscription
Mirror prod = **manual**, store admin → Settings → Notifications → Webhooks → `orders/paid` → callback:
```
https://{cloud-dev-host}/api/webhooks/shopify
```
That callback is the **only** URL Shopify calls into. Checkout is async (cart permalink → webhook), no return/redirect URL to app.

**Script (shipped in #740, ahead of O2 — its immediate use is local-tunnel churn, design §3):** `npm run shopify:webhook -- --url <url> [--commit]` — idempotent upsert via the Admin API, reusing `shopify.ts`'s `getAccessToken` + `shopifyFetch`; dry-run by default. Manual admin registration stays the recommended cloud-dev path. **Secret caveat:** Shopify signs deliveries to an API-created subscription with the **app client secret**, so an instance relying on a script-registered webhook needs `SHOPIFY_WEBHOOK_SECRET` set to that value, not the store signing secret (design §2/§4). The Admin API also only lists subscriptions created by this app — a manually registered webhook is invisible to the script and keeps firing on its own.

## Phase 4 — secret wiring (AWS, NOT this repo)
Prod/dev run on **AWS ECS** (`us-east-2`), deployed via GitHub OIDC ([`deploy-dev.yml`](/.github/workflows/deploy-dev.yml)). Secrets are **not** in `.env`, compose, or the workflow — they're injected at runtime by the **ECS task-def `secrets:` block → AWS Secrets Manager / SSM**, defined in Terraform at `~/projects/treehouse/aws/infra/modules/checkin/` (external repo).

So "env wiring" = an **infra-repo change**, not an edit here:
- The three server-side secrets (`SHOPIFY_CLIENT_ID/SECRET`, `SHOPIFY_WEBHOOK_SECRET`) + `SHOPIFY_STORE_DOMAIN` → **AWS Secrets Manager** (dev env secret) → mapped in the task-def `secrets:` block. `SHOPIFY_STORE_DOMAIN` is the single store-domain var; the client checkout link reads it via the server (`EnvProvider` → `useShopifyStoreDomain`), so there is no separate build-arg.
- Redeploy cloud-dev → ECS pulls new values → `shopifyConfiguredEnv()` true → real store on, mock off.

**This repo needs zero change for secret wiring** — getters already read `process.env`.
> Exact Secrets Manager keys / task-def `secrets:` names live in the external infra repo — not visible from this checkout.

`BoardSettings` variant/discount ids (O4): leave null in seed; set once via [`settings/membership`](../../src/app/settings/membership/page.tsx) after the store exists. Matches how prod is configured. No seed change.

## Phase 5 — local = mock by default
Locals keep the in-process mock (Phase 0). Tunnel (`cloudflared`/`ngrok` → callback `https://<random>.trycloudflare.com/api/webhooks/shopify`) is **opt-in only** for checkout-UI-fidelity work. A store has **one** `orders/paid` URL — cloud-dev owns it; sending locals to the mock removes subscription contention.

## Phase 6 — verify + runbook
1. Cloud-dev: create a `PENDING_PAYMENT` process → click real permalink → pay via **Bogus Gateway** (real webhook, fake money) → confirm HMAC passes → `activate()` → `ACTIVE` + congrats email.
2. Runbook: dev-store password page can't be removed (testers need storefront password); dev store is non-transferable/throwaway.

---

## Blockers before Phase 1
| | Question | Recommend |
|--|--|--|
| **O1** | Own a Shopify Partner org? | needs owner — hard blocker |
| **O2** | Cloud-dev URL stable across redeploy? | if not, build the Phase-3 script + run on deploy |
| **O6** | Bogus Gateway enough for payment testing? | yes |

## Net new work
- **This repo:** shipped in #740 — the registration script + unit tests, dev orders/paid route hardening + integration suite, and the Shopify config-fuse tests.
- **Infra repo:** add dev-store secrets to Secrets Manager + task-def `secrets:` mapping.
- **Ops:** Partner org → dev store → app → product/variant/discount → manual `orders/paid` subscription.

Mock stays as the local default via the gate that already ships. Prod byte-for-byte unchanged.
