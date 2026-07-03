# Shopify Dev-Store Webhook — Implementation Plan

**Status:** Plan — no code written.
**Companion:** [`SHOPIFY_DEV_STORE_WEBHOOK.md`](./SHOPIFY_DEV_STORE_WEBHOOK.md) (design/rationale).
**Fallback mock:** `origin/claude/wonderful-tesla-621492` @ `455362c2` (in-process orders/paid mock).

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

## Phase 0 — land the mock (prereq)
Merge `origin/claude/wonderful-tesla-621492` (455362c2). Its `shopifyMockActive()` gate is the entire mock↔real switch. Setting real creds opts an instance out of the mock automatically — no branch. Nothing to build.

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
| `SHOPIFY_WEBHOOK_SECRET` | Settings → Notifications → Webhooks (bottom of page: "signed with…") | store-admin path, matches prod |

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

**Optional script (build ONLY if O2 says cloud-dev URL rotates on redeploy):** `npm run shopify:webhook -- <url>` — idempotent upsert via Admin API `POST/PUT /admin/api/2026-01/webhooks.json`, reusing `shopify.ts`'s `getAccessToken` + `shopifyFetch`. Prod proves manual is enough; don't build this unless the URL churns.

## Phase 4 — secret wiring (AWS, NOT this repo)
Prod/dev run on **AWS ECS** (`us-east-2`), deployed via GitHub OIDC ([`deploy-dev.yml`](/.github/workflows/deploy-dev.yml)). Secrets are **not** in `.env`, compose, or the workflow — they're injected at runtime by the **ECS task-def `secrets:` block → AWS Secrets Manager / SSM**, defined in Terraform at `~/projects/treehouse/aws/infra/modules/checkin/` (external repo).

So "env wiring" = an **infra-repo change**, not an edit here:
- The three server-side secrets (`SHOPIFY_CLIENT_ID/SECRET`, `SHOPIFY_WEBHOOK_SECRET`) + server-side `SHOPIFY_STORE_DOMAIN` → **AWS Secrets Manager** (dev env secret) → mapped in the task-def `secrets:` block.
- Client-bundle `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` → GitHub repo `vars` build-arg (public, like prod).
- Redeploy cloud-dev → ECS pulls new values → `shopifyConfiguredEnv()` true → real store on, mock off.

**This repo needs zero change for secret wiring** — getters already read `process.env`.
> Exact Secrets Manager keys / task-def `secrets:` names live in the external infra repo — not visible from this checkout.

`BoardSettings` variant/discount ids (O4): ~~leave null in seed; set once via [`settings/membership`](../../src/app/settings/membership/page.tsx) after the store exists. Matches how prod is configured. No seed change.~~ **Superseded:** `seedBaseline` now upserts placeholder ids (`dev-mock-variant-normal`/`-volunteer`, a placeholder discount code, non-zero dues) so the in-process mock is clickable with zero setup on a fresh DB — a deliberate deviation, called out inline in `seed-helpers.ts`. Real dev-store ids still overwrite these via `settings/membership` once a store exists.

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
- **This repo:** ~0 lines (optionally: one idempotent registration script, only if O2 fails).
- **Infra repo:** add dev-store secrets to Secrets Manager + task-def `secrets:` mapping.
- **Ops:** Partner org → dev store → app → product/variant/discount → manual `orders/paid` subscription.

Mock stays as the local default via the gate that already ships. Prod byte-for-byte unchanged.
