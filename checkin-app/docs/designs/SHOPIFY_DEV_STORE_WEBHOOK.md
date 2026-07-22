# Shopify Development Store + Webhooks in Dev/Local

**Status:** Implemented in part — the in-process mock (§6) landed via #730; mock hardening + the §2 registration script via #740. The real dev store (§2–§5) remains ops work, blocked on O1/O2. (The former separate implementation-plan doc was folded into this one; its runbook lives in §2 and §9.)
**Author:** design pass, 2026-07-02 (revised after grepping prod deploy + `src/`)
**Related:** [`ZOHO_SIGN_DEV_MOCK.md`](./ZOHO_SIGN_DEV_MOCK.md) (#669, in-process sign mock), #665 (email dev inbox), #278 (checkout-token honor-system TODO), #624/#625 (order-amount / price-alignment safety), #683 (Shopify env routed through `config.ts`)

## 0. Scope check — what already exists

Confirmed by `git log` + grep before writing: **no Shopify dev-store or webhook-mock work had landed or was in flight.** Recent Shopify commits were #683 (route env through `config.ts`), #624 (validate order amount), #466 (fetch timeouts); the sibling dev features (Zoho mock #669, email inbox #665) don't touch Shopify. Greenfield.

Unlike Zoho (fully in-process mock), the ask here is a **real Shopify development store** so genuine `orders/paid` webhooks drive `PENDING_PAYMENT → ACTIVE` end-to-end. An in-process mock is the zero-infra fallback (§6). Every dev-only path is env-gated the same way Zoho's is — **prod behavior is unchanged**.

The prod path itself is **already built and correct** (verified in `src/`): the inbound route + timing-safe HMAC verify (`api/webhooks/shopify/route.ts`), the `withWebhook` wrapper (`webhookAuth.ts`), the env getters and the `shopifyMockActive()` switch (`config.ts`). Making it "real" = store setup + secret wiring + (maybe) one registration script. **No new prod route, no touching verify, no new config getters.**

---

## 1. Current flow (as wired today)

1. **Build the checkout link** — [`payment.ts › ensurePaymentLink`](../../src/lib/membership/payment.ts) reads `BoardSettings.orgMembershipVariantId` + `config.shopifyStoreDomain()` and calls `buildMembershipCheckoutUrl`, producing a Shopify **cart permalink**:
   ```
   https://{SHOPIFY_STORE_DOMAIN}/cart/{variantId}:1?discount={code}&attributes[Membership_Process_ID]={processId}
   ```
   Volunteer households get `discount=<BoardSettings.volunteerDiscountCode>`. The process id rides as a **cart attribute** so the webhook can match the payment back. Domain or variant unset → link is `null`.
2. **Applicant pays** on the hosted store checkout. Shopify maps `attributes[Membership_Process_ID]` onto the Order's `note_attributes`.
3. **`orders/paid` fires** → [`api/webhooks/shopify/route.ts`](../../src/app/api/webhooks/shopify/route.ts), wrapped by `withWebhook({ provider: "shopify", verify: verifyShopifyHmac })` ([`webhookAuth.ts`](../../src/lib/webhookAuth.ts)): per-IP rate-limit → HMAC verify → JSON parse → handler.
4. **HMAC verify** — `verifyShopifyHmac` computes `HMAC-SHA256(rawBody, config.shopifyWebhookSecret())` in base64 and `timingSafeEqual`s against `x-shopify-hmac-sha256`, over the exact raw bytes before parse. Unset secret → **500**; missing/wrong sig → **401**.
5. **Match by cart attribute** — handler scans `note_attributes` for `Membership_Process_ID`, then checks the order's `line_items` actually contain a known membership variant (`orgMembershipVariantId` / `shopifyNormalVariantId` / `shopifyVolunteerVariantId`) — the #624/H2 guard against paying for an unrelated item of the same total.
6. **`activate()`** ([`payment.ts`](../../src/lib/membership/payment.ts), via `activateByProcessId`) — `FOR UPDATE` lock, idempotent on retry. Flips `ACTIVE` if the background check cleared (else holds `PENDING_BG_CLEARANCE`); paid-while-`BLOCKED` and no-membership-item become board-alerted anomalies, not silent no-ops. On `ACTIVE`, sends the one congrats email.

### What's missing in dev today

| Gap | Symptom in dev |
|-----|----------------|
| No `SHOPIFY_STORE_DOMAIN/CLIENT_ID/CLIENT_SECRET` | `shopify.ts` logs "integration disabled"; no Admin API; variant creation is a no-op |
| No `BoardSettings.orgMembershipVariantId` (seed does **not** set it) | `ensurePaymentLink` returns `checkoutUrl: null`; nothing to click |
| No `SHOPIFY_WEBHOOK_SECRET` | inbound webhook 500s (config-error branch) |
| No public URL | even a real store can't reach `localhost:4000` |

So the payment leg is **untestable locally** end-to-end. §2/§6 close these gaps.

---

## 2. Dev store setup (ops runbook)

Per [Shopify's dev-store docs](https://shopify.dev/docs/apps/build/dev-dashboard/stores/development-stores). **Hard blocker: O1 — do we own a Shopify Partner org?** Needs an owner before any of this.

**Create the store** — Dev Dashboard → Stores → Create store → name it (`treehouse-checkin-dev`), pick a plan, log in. Requires a Partner account (or merchant dev-permissions) → O1. Dev-store limitations that matter:
- **No real transactions** — payment testing uses the **Bogus Gateway** / test mode, which still fires a real `orders/paid` (real webhook, fake money — the whole point).
- **Password page can't be removed** — checkout link works but testers need the storefront password (note in runbook).
- **Non-transferable throwaway** — not a future prod store.

**Install a custom app** — the client uses the **Client Credentials Grant** (`shopify.ts › getAccessToken`, API version `2026-01`), so a custom app with client id/secret, not a legacy private-app token. Develop apps → Create app → install to the store (install is what makes the token grant work). Admin API scopes: `read/write_products` (variant creation), `read/write_orders` (webhook order data), `read/write_inventory` (`inventory_levels/set` for capped programs), `read/write_discounts` (volunteer code). No Storefront scopes — checkout is the hosted cart permalink. **No OAuth redirect URL** — Client Credentials Grant is server-to-server; the only URL Shopify calls into is the webhook callback.

**Get the four values:**

| Env var | Where in Shopify | Notes |
|---------|------------------|-------|
| `SHOPIFY_STORE_DOMAIN` | Settings → Domains | the raw `*.myshopify.com`, not a pretty domain |
| `SHOPIFY_CLIENT_ID` | app → API credentials | shown directly |
| `SHOPIFY_CLIENT_SECRET` | app → API credentials | reveal-once, copy now |
| `SHOPIFY_WEBHOOK_SECRET` | Settings → Notifications → Webhooks (bottom: "signed with…") | store-admin path, matches prod. **If instead created via the §2 script, use the app client secret** — Shopify signs API-created subscriptions with it |

Verify the creds before trusting them:
```
curl -X POST https://{STORE_DOMAIN}/admin/oauth/access_token \
  -d grant_type=client_credentials -d client_id={ID} -d client_secret={SECRET}
```
200 + `access_token` = good; 401 = wrong creds or app not installed.

**Register the `orders/paid` subscription** — subscribe `orders/paid` (primary; the handler also tolerates `orders/create`) pointed at `{instance}/api/webhooks/shopify`. Two ways:
- Admin **Settings → Notifications → Webhooks** — manual, per-store, **recommended (mirrors prod)**, or
- `npm run shopify:webhook -- --url <callback> [--commit]` (shipped in #740; idempotent Admin-API upsert reusing `getAccessToken`/`shopifyFetch`, dry-run by default) — built primarily for the §3 local-tunnel churn.

**Secret pairing is the #1 cause of 401s here:** a store-admin-created webhook is signed with the **store's webhook signing secret**; an Admin-API-created one is signed with the **app client secret**. Pick one path, put the matching value in `SHOPIFY_WEBHOOK_SECRET`. The Admin API also only lists subscriptions this app created — a manually registered webhook is invisible to the script and keeps firing on its own. **Prod precedent (grep):** no webhook-registration code in `src/` (`grep webhooks.json` → 0 hits), so prod's subscription was registered by hand → prod uses the store signing secret. Mirror it for the dev store; build/rely on the script only if O2 shows cloud-dev's URL rotates.

**Membership product** — one product ("Treehouse Membership") with a variant per tier (normal / volunteer), plus the volunteer discount code. Record the variant ids.

**Where each value lives** (mirrors prod, don't hardcode):

| Value | Home | Why |
|-------|------|-----|
| `SHOPIFY_*` secrets + `SHOPIFY_STORE_DOMAIN` | **AWS Secrets Manager → ECS task-def `secrets:`** (see §4) | `config.ts` reads them from `process.env` at runtime. `SHOPIFY_STORE_DOMAIN` is the **single** store-domain var — the client checkout link reads it via the server (root layout → `EnvProvider` → `useShopifyStoreDomain`), so there's no build-time `NEXT_PUBLIC_` copy |
| `orgMembershipVariantId`, `volunteerDiscountCode`, `normalDuesCents`, `volunteerDuesCents` | **`BoardSettings`** (row id 1) | admin-editable via [`settings/membership`](../../src/app/settings/membership/page.tsx). (`shopifyNormalVariantId` / `shopifyVolunteerVariantId` are matched by the webhook's H2 check but have **no UI writer** — DB-only legacy) |
| dev defaults for those `BoardSettings` | **none — not seeded** (O4, §6) | a placeholder id seeded into the shared `BoardSettings` lands on cloud-dev via the dev-dashboard reset and silently fails the real store's H2 variant check; set once per environment via `settings/membership` |

Seed can't know a real store's variant ids ahead of time. **(a) seed leaves them null; the runbook sets them once in `settings/membership`** — lazier and matches how prod is configured. (Recommended over (b) read-from-env.)

---

## 3. Webhook routing / reachability

Shopify must POST to a **publicly reachable** URL.

- **Cloud-dev** — already public. Subscribe `{cloud-dev-host}/api/webhooks/shopify`. Stable as long as the host is (→ O2).
- **Local laptop** — `localhost:4000` isn't reachable; put a tunnel in front (Cloudflare `cloudflared tunnel --url http://localhost:4000` or `ngrok http 4000`). **The URL changes each restart** (unless you pay for a reserved subdomain) → re-register the subscription each session; the `npm run shopify:webhook` helper keeps that a one-liner (mind the app-client-secret caveat, §2). The app port is fixed at 4000 regardless of the worktree-port convention — point the tunnel there.

**Recommended split:** cloud-dev = real dev store (stable public URL, shared team store); local = in-process mock by default (§6), tunnel opt-in only for exercising the *actual* Shopify checkout UI. Tunnels are fiddly and the URL churns; most local work only needs "a paid webhook lands and activates the process," which the mock delivers with zero infra.

---

## 4. HMAC / secret handling

**Verification stays real and unchanged** — timing-safe HMAC over raw bytes. The only per-env variable is the *value* of `SHOPIFY_WEBHOOK_SECRET`:
- **Prod** — the prod store's real signing secret (already wired).
- **Cloud-dev / local-with-tunnel** — the **dev store's own real signing secret**, so verification is genuinely end-to-end (the same code path prod runs).
- **In-process mock (§6)** — a **fixed dev secret**, exactly like Zoho, since the mock self-signs.

**Why not copy Zoho's fixed-secret trick to the real store.** Zoho's mock generates and self-fires its own payload, so its `DEV_MOCK_WEBHOOK_SECRET` "guards nothing real; it exists only so the timing-safe compare has a value." A real dev store signs with a secret **we don't choose**, so a fixed constant would 401 every real webhook. Clean rule: **fixed secret ⇔ self-fired mock; real secret ⇔ real store.** `shopifyWebhookSecret()` returns `null` when unset (→ handler 500) — no `config.ts` fallback for the real path; leave it.

**Where the real secret lives (AWS, not this repo).** `config.ts` only reads `process.env.SHOPIFY_WEBHOOK_SECRET`; prod/dev run on **AWS ECS (`us-east-2`), deployed via GitHub OIDC (`deploy-dev.yml`)**, and the value is injected at runtime by the **ECS task-def `secrets:` block from AWS Secrets Manager / SSM**, defined in Terraform at `~/projects/treehouse/aws/infra/modules/checkin/` (external repo; not in `.env`, compose, or the GitHub workflow). So wiring the dev store = an **infra-repo change** (add the values to Secrets Manager + map them in the task-def) then redeploy cloud-dev so `shopifyConfiguredEnv()` flips true. **This app repo needs no change** — the getters already read `process.env`. (Exact Secrets Manager keys / task-def entry names live in that external repo.)

---

## 5. Shared vs. per-developer store

**One shared team dev store.**

| | Shared team store | Per-developer store |
|--|--|--|
| Setup cost | once | every dev repeats §2 |
| Credentials | one set in Secrets Manager → cloud-dev task-def | each dev's own Partner org |
| Webhook URL contention | a store has **one** `orders/paid` URL — two devs tunnelling at once clobber each other | none |
| Test-order pollution | shared order history gets noisy | isolated |

Contention decides it, but §3 already sends local dev to the **mock**, not the tunnel — so locals never contend, and the shared store's single subscription is owned by **cloud-dev** (stable URL, set once). Order pollution on a throwaway store is a non-issue. Per-dev stores only for someone who genuinely needs isolated real-checkout testing — rare.

---

## 6. Mock alternative (zero-infra fallback) — shipped #730 (the original `claude/wonderful-tesla-621492` branch is superseded — don't merge it)

Mirror Zoho #669: a dev-only route `POST /api/dev/shopify/orders-paid` that:
1. 404s unless `config.shopifyMockActive()` (non-prod + Shopify real creds unset), same shape as `zohoMockActive`.
2. Takes a `processId`, synthesizes a realistic `orders/paid` payload (`note_attributes[Membership_Process_ID]`, `line_items` with the configured membership variant id, an `id`), signs it with a **fixed dev webhook secret** (§4), and **fires the REAL inbound webhook** — driving the exact verify → match → `activate()` path prod runs.
3. Surfaced from the dev UI ("Simulate membership payment") alongside `/dev`.

`config.ts` gains a `shopifyMockActive()` gate + a fixed `DEV_MOCK_SHOPIFY_WEBHOOK_SECRET` fallback in `shopifyWebhookSecret()`, both structured like the Zoho ones. The gate is the entire mock↔real switch: setting real creds opts an instance out of the mock automatically — no code branch.

**The variant id is configuration, never hardcoded.** A recurring review question — "how can variant ids in our code align with a real store's?" — is moot: the id is never in code, it lives in `BoardSettings.orgMembershipVariantId`, set once per environment.
- **Mock (local, no creds):** just a **correlation token** — the mock echoes it in the synthesized `line_items`, the inbound handler matches it against the *same* `BoardSettings`. A closed loop; any string works.
- **Real dev store (cloud-dev, creds):** the **store's actual variant id**, set by a human after creating the product.

Because both read the id from `BoardSettings`, there's nothing to "align." We deliberately don't seed a placeholder (O4).

| | Real dev store | In-process mock |
|--|--|--|
| Fidelity | **high** — real checkout UI + payload shape, real discount application, real HMAC | medium — we author the payload; drift from Shopify's schema possible |
| Setup cost | Partner account, store, app, scopes, tunnel-or-public-URL, secrets | **~zero** — a route + a gate |
| Exercises `ensurePaymentLink` | yes | only if the mock UI reuses the real link build |
| Catches Shopify-side surprises | yes | no |

**Build order: mock first, real store second; they coexist.** The mock unblocks every local dev immediately (Zoho precedent, zero infra, deterministic tests) and is the default local experience; the real store on cloud-dev adds true end-to-end fidelity — valuable but not blocking.

---

## 7. Prod safety

- **Every dev-only surface is env-gated.** `/api/dev/shopify/*` 404s unless `shopifyMockActive()`, which is `false` in prod by construction: `readCheckinEnv() === 'local'`, failing safe to prod when unset (the `NODE_ENV` fuse was eliminated in the #951 review — every deployed instance runs the production image, so it never distinguished prod from cloud-dev).
- **No dev store domain hardcoded** — `SHOPIFY_STORE_DOMAIN` stays env-only.
- **Fixed dev webhook secret unreachable in prod** — only returned by `shopifyWebhookSecret()` when the mock is active.
- **Prod webhook path is byte-for-byte unchanged** — real secret, real HMAC, real store. This proposal only adds env values and a gated dev route.

---

## 8. Open questions / decisions before implementation

- **O1.** Do we own a **Shopify Partner org**? Creating a dev store needs one — hard blocker on §2. *(decision + owner needed)*
- **O2.** Is **cloud-dev's URL stable** across redeploy, or does it rotate? If it rotates, cloud-dev also needs the Admin-API re-register helper (§2/§3) run on deploy. *(needs infra answer)*
- **O3.** Build the mock first, defer the real store — confirmed: yes.
- **O4.** Seed `BoardSettings` variant/discount: leave null + document manual one-time setup (recommended), or read from env?
- **O5.** Volunteer discount / per-process checkout token (#278) is still honor-system; a dev store lets us *test* the flow but doesn't fix the token gap — out of scope here (#278 tracks it).
- **O6.** Bogus Gateway enough for all dev payment testing? Almost certainly yes.

---

## 9. Verify + net work

**Acceptance test (cloud-dev):** create a `PENDING_PAYMENT` process → click the real permalink → pay via **Bogus Gateway** → confirm HMAC passes → `activate()` → `ACTIVE` + congrats email. The first `workflow_dispatch`/manual run is the acceptance test.

**Net new work:**
- **This repo:** shipped in #740 — the registration script + unit tests, dev `orders/paid` route hardening + integration suite, the Shopify config-fuse tests. Nothing else; the mock stays the local default via the gate that already ships.
- **Infra repo:** add dev-store secrets to Secrets Manager + task-def `secrets:` mapping.
- **Ops:** Partner org → dev store → app → product/variant/discount → manual `orders/paid` subscription.

Prod byte-for-byte unchanged.
