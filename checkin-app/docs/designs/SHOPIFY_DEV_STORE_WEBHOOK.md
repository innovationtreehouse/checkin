# Shopify Development Store + Webhooks in Dev/Local

**Status:** Proposal — for review. No code written.
**Author:** design pass, 2026-07-02 (revised 2026-07-02 after grepping prod deploy + `src/`)
**Related:** [`ZOHO_SIGN_DEV_MOCK.md`](./ZOHO_SIGN_DEV_MOCK.md) (#669, in-process sign mock), #665 (email dev inbox), #278 (checkout-token honor-system TODO), #624/#625 (order-amount / price-alignment safety), #683 (Shopify env routed through `config.ts`)
**Implementation plan:** [`SHOPIFY_DEV_STORE_WEBHOOK_PLAN.md`](./SHOPIFY_DEV_STORE_WEBHOOK_PLAN.md) (concrete steps + two prod-grounded corrections folded back into §2/§4 below).

## 0. Scope check — what already exists

Confirmed by `git log` + grep before writing this: **no Shopify dev-store or webhook-mock work has landed or is in flight.** The only recent Shopify commits are #683 (route env through `config.ts`), #624 (validate order amount before activating), and #466 (fetch timeouts). The two sibling dev-integration features — Zoho Sign mock (#669) and email inbox (#665) — do **not** touch Shopify. So this is greenfield; nothing to redesign.

Unlike Zoho (which got a fully in-process mock), the ask here is to connect to a **real Shopify development store** so genuine `orders/paid` webhooks fire against the dev instance and drive `PENDING_PAYMENT → ACTIVE` end-to-end. An in-process mock is also proposed as the zero-infra fallback (§6). **Prod behavior is unchanged** — every dev-only path is env-gated the same way Zoho's is.

---

## 1. Current flow (as wired today)

Trace from checkout link to activation:

1. **Build the checkout link** — [`payment.ts › ensurePaymentLink`](../../src/lib/membership/payment.ts) reads `BoardSettings.membershipVariantId` + `config.shopifyStoreDomain()` and calls `buildMembershipCheckoutUrl`, producing a Shopify **cart permalink**:
   ```
   https://{SHOPIFY_STORE_DOMAIN}/cart/{variantId}:1?discount={code}&attributes[Membership_Process_ID]={processId}
   ```
   Volunteer households get `discount=<BoardSettings.volunteerDiscountCode>` appended. The process id rides along as a **cart attribute** so the webhook can match the payment back. If domain or variant is unset, the link is `null`.

2. **Applicant pays on Shopify** — hosted checkout on the store. Shopify maps cart-attribute `attributes[Membership_Process_ID]` onto the Order's `note_attributes`.

3. **`orders/paid` webhook fires** → [`api/webhooks/shopify/route.ts`](../../src/app/api/webhooks/shopify/route.ts), wrapped by `withWebhook({ provider: "shopify", verify: verifyShopifyHmac })` ([`webhookAuth.ts`](../../src/lib/webhookAuth.ts)): per-IP rate-limit → HMAC verify → JSON parse → handler.

4. **HMAC verify** — `verifyShopifyHmac` computes `HMAC-SHA256(rawBody, config.shopifyWebhookSecret())` in base64 and `timingSafeEqual`s it against `x-shopify-hmac-sha256`. Unset secret → **500** (config error); missing/wrong sig → **401**. Verified over the exact raw bytes before parse.

5. **Match by cart attribute** — handler scans `note_attributes` for `Membership_Process_ID`, then checks the order's `line_items` actually contain a known membership variant (`membershipVariantId` / `shopifyNormalVariantId` / `shopifyVolunteerVariantId` from `BoardSettings`) — the #624/H2 guard against paying for an unrelated item that totals the same.

6. **`activate()`** ([`payment.ts`](../../src/lib/membership/payment.ts), via `activateByProcessId`) — `FOR UPDATE` row lock, idempotent on webhook retry. Flips `ACTIVE` if the background check already cleared (else holds `PENDING_BG_CLEARANCE`); handles paid-while-`BLOCKED` and no-membership-item as board-alerted anomalies rather than silent no-ops. On `ACTIVE`, sends the one congrats email.

### What's missing in dev today

Everything upstream of the handler. Concretely:

| Gap | Symptom in dev |
|-----|----------------|
| No `SHOPIFY_STORE_DOMAIN/CLIENT_ID/CLIENT_SECRET` set | `shopify.ts` logs "integration disabled"; no Admin API; product/variant creation is a no-op |
| No `BoardSettings.membershipVariantId` (seed does **not** set it — grep of `prisma/seed.ts` is empty) | `ensurePaymentLink` returns `checkoutUrl: null`; nothing to click |
| No `SHOPIFY_WEBHOOK_SECRET` | inbound webhook 500s (`verifyShopifyHmac` config-error branch) |
| No public URL | even a real store can't reach `localhost:4000` |

So the payment leg of membership is **untestable locally** end-to-end right now. This proposal closes those four gaps.

---

## 2. Dev store setup

Per [Shopify's development-stores docs](https://shopify.dev/docs/apps/build/dev-dashboard/stores/development-stores):

**Create the store**
1. Shopify [Dev Dashboard](https://dev.shopify.com/dashboard/) → **Stores** → **Create store**.
2. Name it (e.g. `treehouse-checkin-dev`), pick a plan tier, confirm, log in.
3. Requires a **Shopify Partner account** (or a merchant store with developer permissions). → *see open question O1.*

**Dev-store limitations that matter to us** (from the docs):
- **Cannot process real transactions.** Payment testing uses the **Bogus Gateway** / test mode — fine for us: a Bogus-Gateway checkout still fires a real `orders/paid` webhook. This is the whole point (real webhook, fake money).
- Only free / partner-friendly apps are installable — irrelevant, our app is a custom app.
- The store **password page can't be removed** — the checkout link works, but testers need the storefront password. Document it in the runbook.
- Dev stores are **non-transferable** — a throwaway, not a future prod store.

**Install a custom app + Admin API access**
Our client uses the **Client Credentials Grant** (`shopify.ts › getAccessToken`, API version `2026-01`), so we need a custom app with client id/secret, not a legacy private-app token:
1. In the dev store admin: **Settings → Apps and sales channels → Develop apps → Create an app** (or create it in the Dev Dashboard and install to this store).
2. **Admin API scopes:** `write_products`, `read_products` (product/variant creation in `shopify.ts`), `read_orders` / `write_orders` (order data on the webhook), `read_inventory` / `write_inventory` (the `inventory_levels/set` call for capped programs), `write_discounts` / `read_discounts` (volunteer discount code). Storefront scopes not needed — checkout is the hosted cart permalink.
3. Grab **Client ID** and **Client secret** → env `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`; the `*.myshopify.com` domain → `SHOPIFY_STORE_DOMAIN`.

**Webhook subscription(s)**
Subscribe **`orders/paid`** (primary; the handler also tolerates `orders/create`) pointed at `{instance}/api/webhooks/shopify`. Two ways:
- Admin **Settings → Notifications → Webhooks** (manual, per-store) — **recommended, mirrors prod**, or
- Admin API `POST /admin/api/2026-01/webhooks.json` (scriptable — only worth building if the callback URL rotates, §3/O2).

> **Prod precedent (verified by grep):** there is **no webhook-registration code anywhere in `src/`** — `grep webhooks.json` returns zero hits, and `shopify.ts` only creates product variants. So prod's `orders/paid` subscription was **registered by hand in the store admin**, meaning prod uses the **store webhook signing secret** path. Mirror it for the dev store: register manually, paste the store's signing secret into `SHOPIFY_WEBHOOK_SECRET`. Build the Admin-API script (§3) **only** if O2 shows cloud-dev's URL rotates and needs unattended re-registration.

Shopify shows the **webhook signing secret** once per store → env `SHOPIFY_WEBHOOK_SECRET` (§4). Note: an app-level `webhookSubscriptions` uses the **app's** API secret to sign; a store-admin-created webhook uses the store's **webhook signing secret**. Pick one path and keep the matching secret — mismatched secret is the #1 cause of 401s here. (We pick the store-admin path, per the prod precedent above.)

**Membership product + variant + discount**
- Create one **product** ("Treehouse Membership") with a variant per tier (normal / volunteer), or a single variant if the discount code covers volunteers.
- Create the **volunteer discount code** in the store; set its code string.

**Where each value lives** (mirrors prod, don't hardcode):

| Value | Home | Why |
|-------|------|-----|
| `SHOPIFY_CLIENT_ID`, `_CLIENT_SECRET`, `_WEBHOOK_SECRET` (+ server-side `SHOPIFY_STORE_DOMAIN`) | **AWS Secrets Manager → ECS task-def `secrets:`** (see §4) | prod/dev run on ECS; `config.ts` reads them from `process.env` at runtime — this app repo stores nothing |
| `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` (client bundle only) | **GitHub repo `vars` → build-arg** | public, baked into the client bundle at build time (non-secret); how prod already sets it ([`deploy-dev.yml`](/.github/workflows/deploy-dev.yml)) |
| `membershipVariantId`, `shopifyNormalVariantId`, `shopifyVolunteerVariantId`, `volunteerDiscountCode`, `normalDuesCents`, `volunteerDuesCents` | **`BoardSettings`** (row id 1) | admin-editable via [`settings/membership`](../../src/app/settings/membership/page.tsx) |
| dev defaults for those `BoardSettings` | **seed** (`prisma/seed.ts`) — *new* | seed currently sets none; a dev store's variant/discount ids should be seeded (or set once via the settings UI) so a fresh local DB has a clickable link |

> **No OAuth redirect/callback URL to configure.** The client uses the Client Credentials Grant (server-to-server, `shopify.ts › getAccessToken`), so custom-app setup needs no redirect URI. The only URL Shopify calls into is the webhook callback `{host}/api/webhooks/shopify`; checkout is an async cart permalink with no return-to-app URL.

> Seed can't know a real store's variant ids ahead of time. Options: (a) seed leaves them null and the dev runbook says "set them once in `settings/membership` after creating the store," or (b) seed reads them from env (`SHOPIFY_DEV_MEMBERSHIP_VARIANT_ID` etc.) if present. **(a) is lazier and matches how prod is configured** — recommend (a).

---

## 3. Webhook routing / reachability (the hard part)

Shopify must POST to a **publicly reachable** URL. Two environments, two answers:

### Cloud-dev instance — easy
Already public. Subscribe `{cloud-dev-host}/api/webhooks/shopify` in the dev store (or via Admin API). Nothing else. The URL is stable as long as the host is (→ open question O2).

### Local laptop — needs a tunnel
`localhost:4000` isn't reachable. Put a tunnel in front:
- **Cloudflare Tunnel** (`cloudflared tunnel --url http://localhost:4000`) or **ngrok** (`ngrok http 4000`). Either yields an `https://<random>.trycloudflare.com` / `.ngrok-free.app` URL.
- Register that URL as the store's `orders/paid` subscription. **The URL changes each tunnel restart** (unless you pay for a reserved subdomain / named Cloudflare tunnel) → re-register the subscription each session. A tiny `npm run shopify:webhook -- <url>` helper that upserts the subscription via Admin API keeps it a one-liner (not built here — noted for impl).
- **Worktree note:** local dev binds `4000`; per the worktree-port convention throwaway services get a suffix, but the app port itself is fixed at 4000 — point the tunnel there.

### Recommended split
**Cloud-dev = real dev store** (stable public URL, shared team store, real webhooks). **Local laptop = in-process mock by default** (§6), with the tunnel as an opt-in for anyone who needs to exercise the *actual* Shopify checkout UI. Rationale: tunnels are fiddly and the URL churns; most local work only needs "a paid webhook lands and activates the process," which the mock delivers with zero infra. Reserve the real-store-over-tunnel path for checkout-fidelity work.

---

## 4. HMAC / secret handling

**Verification stays real and unchanged** — `verifyShopifyHmac` already does a timing-safe HMAC over raw bytes. We do **not** weaken it in dev. The only per-env variable is the *value* of `SHOPIFY_WEBHOOK_SECRET`:

- **Prod:** prod store's real webhook signing secret (already wired).
- **Cloud-dev / local-with-tunnel:** the **dev store's own real signing secret**. Because a real Shopify store signs each webhook with a real secret, verification is genuinely end-to-end — the same code path prod runs, exercised for real.

### Why NOT copy the Zoho fixed-dev-secret trick here
Zoho's mock uses a **fixed** `DEV_MOCK_WEBHOOK_SECRET = 'dev-zoho-mock-webhook-secret'` ([`config.ts:54`](../../src/lib/config.ts)) because the mock **generates and self-fires its own payload** — the secret "guards nothing real; it exists only so the timing-safe compare has a value." That's correct *for a self-fired mock*.

A **real dev store is different**: Shopify signs with a secret **we don't choose**, so verification only passes if `SHOPIFY_WEBHOOK_SECRET` holds the store's *actual* secret. Substituting a fixed constant would make every real webhook 401. So:
- **Real dev store → real per-store secret in env** (no fallback in `config.ts` — `shopifyWebhookSecret()` already returns `null` when unset, which the handler surfaces as 500. Good; leave it).
- **In-process mock (§6) → fixed dev secret**, exactly like Zoho, since the mock self-signs. This is the one place the Zoho pattern transfers.

This gives a clean rule: *fixed secret ⇔ self-fired mock; real secret ⇔ real store.*

### Where the real secret is actually stored (AWS, not this repo)
`config.ts` only ever reads `process.env.SHOPIFY_WEBHOOK_SECRET` — it neither knows nor cares where that came from. In prod/dev the value is **injected at runtime by the ECS task definition's `secrets:` block from AWS Secrets Manager / SSM**, defined in Terraform at `~/projects/treehouse/aws/infra/modules/checkin/` (external infra repo; the deploy workflows assume the `checkin-deploy-{dev,prod}` roles there). It is **not** in `.env`, `docker-compose*.yml`, or the GitHub workflow — only `NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN` appears there, as a public build-arg.

So wiring the dev store's secrets = **an infra-repo change** (add the dev-store values to Secrets Manager + map them in the task-def `secrets:`), then redeploy cloud-dev so `shopifyConfiguredEnv()` flips true. **This app repo needs no change for secret wiring** — the getters already read `process.env`. (Exact Secrets Manager keys / task-def entry names live in that external repo, not visible from this checkout.)

---

## 5. Shared vs. per-developer store

**Recommend: one shared team dev store.**

| | Shared team store | Per-developer store |
|--|--|--|
| Setup cost | once | every dev repeats §2 |
| Credentials | one set in AWS Secrets Manager → cloud-dev task-def (§4) | each dev manages their own Partner org |
| Webhook URL contention | **real** — a store has *one* `orders/paid` subscription URL; two devs tunnelling at once fight over it | none (each store independent) |
| Test-order pollution | shared order history gets noisy | isolated |

The contention point cuts the decision: a single store can only point `orders/paid` at **one** URL at a time, so two developers each running a tunnel would clobber each other's subscription. But the §3 recommendation already sends **local dev to the in-process mock**, not the tunnel — so local devs never contend for the store's subscription. The shared store's single subscription is owned by **cloud-dev** (stable URL, set once). Order pollution on a throwaway dev store is a non-issue.

Net: **one shared dev store, its webhook subscription owned by cloud-dev; locals use the mock.** Per-dev stores only if someone genuinely needs isolated real-checkout testing — rare.

---

## 6. Mock alternative (zero-infra fallback)

Mirror Zoho #669 exactly. Add a dev-only route — `POST /api/dev/shopify/orders-paid` — that:
1. 404s unless a `config.shopifyMockActive()` gate is true (non-prod + Shopify real creds unset), same shape as `zohoMockActive`.
2. Takes a `processId`, synthesizes a realistic `orders/paid` payload (`note_attributes[Membership_Process_ID]`, `line_items` with the seeded membership variant id, an `id`), signs it with a **fixed dev webhook secret** (§4), and **fires the REAL inbound webhook** `POST /api/webhooks/shopify` — so it drives the exact verify → match → `activate()` path prod runs.
3. Surfaced from a dev UI ("Simulate membership payment" button) alongside the existing `/dev` tools ([`src/app/dev`](../../src/app/dev)).

`config.ts` gains a `shopifyMockActive()` + a `SHOPIFY_MOCK_WEBHOOK_SECRET` fallback in `shopifyWebhookSecret()`, both structured identically to the Zoho ones (`config.ts:45–54, 80–81`).

### Real dev store vs in-process mock

| | Real dev store | In-process mock |
|--|--|--|
| Fidelity | **high** — real checkout UI, real Shopify payload shape, real discount application, real HMAC from Shopify | medium — we author the payload; drift from Shopify's real schema is possible |
| Setup cost | Partner account, store, app, scopes, tunnel-or-public-URL, secret provisioning | **~zero** — a route + a gate, no external anything |
| Exercises checkout-link build (`ensurePaymentLink`) | yes | only if the mock UI reuses the real link build |
| Catches Shopify-side surprises (attribute mapping, discount edge cases) | yes | no |

**Build order: mock first, real store second. They coexist.** The mock unblocks every local dev immediately (matches the Zoho precedent, zero infra, deterministic tests) and is the default local experience. The real dev store on cloud-dev then adds true end-to-end fidelity for the checkout UI and Shopify's real payload — valuable but not blocking. The `shopifyMockActive()` gate means setting real Shopify creds automatically opts an instance *out* of the mock and *into* the real store, so cloud-dev runs real while locals run mock, no code branch beyond the gate.

---

## 7. Prod safety

Same posture as Zoho:
- **Every dev-only surface is env-gated.** `/api/dev/shopify/*` 404s unless `config.shopifyMockActive()` (which is `false` in prod by construction: `readCheckinEnv() !== 'prod' && NODE_ENV !== 'production'`, both fail-safe to prod).
- **No dev store domain hardcoded.** `SHOPIFY_STORE_DOMAIN` stays env-only; the dev store's `*.myshopify.com` never appears in source or seed defaults.
- **Fixed dev webhook secret is unreachable in prod** — only returned by `shopifyWebhookSecret()` when the mock is active, never in prod (same guard as `DEV_MOCK_WEBHOOK_SECRET`).
- **Prod webhook path is byte-for-byte unchanged** — real secret, real HMAC, real store. This proposal adds env values and a gated dev route; it touches no prod branch.

---

## 8. Open questions / decisions before implementation

- **O1.** Do we already own a **Shopify Partner org**? Creating a dev store needs one (or merchant dev-permissions). If not, someone must create it — blocks §2. *(decision + owner needed)*
- **O2.** Is **cloud-dev's URL stable** enough to hold a standing `orders/paid` subscription, or does it rotate on redeploy? If it rotates, cloud-dev also needs the Admin-API re-register helper from §3. *(needs infra answer)*
- **O3.** **Build the mock (§6) first and defer the real store** — confirm this ordering. Recommendation: yes.
- **O4.** Seed `BoardSettings` variant/discount: leave null + document manual one-time setup (recommended), or read from env? *(§2 note)* **Resolved otherwise:** implementation seeds obviously-fake placeholder ids (`dev-mock-variant-normal` / `-volunteer`, a placeholder discount code, non-zero dues) in `seedBaseline` (`src/lib/dev/seed-helpers.ts`) via an idempotent `upsert(..., update: {})`, so a fresh local DB has the in-process mock (§6) immediately clickable with zero manual setup. Deliberate deviation from the "leave null" recommendation above — real dev-store ids (once one exists) overwrite these via the Settings → Membership UI, same as prod.
- **O5.** Volunteer discount / per-process checkout token (#278) is still honor-system. A dev store lets us *test* the flow but doesn't fix the token gap — confirm that's out of scope here (it is; #278 tracks it).
- **O6.** Bogus Gateway acceptable for all dev payment testing, or do we need a real (test-mode) gateway for any card-level fidelity? Bogus is almost certainly enough.

---

## Recommendation summary

1. **Build the in-process `orders/paid` mock first** (§6) — mirror Zoho #669: a gated `/api/dev/shopify/orders-paid` that self-signs and fires the *real* inbound webhook. Zero infra, unblocks all local dev, becomes the default local experience.
2. **Stand up one shared dev store** (§5) and subscribe **cloud-dev's** stable public URL to `orders/paid` (§3). Real end-to-end fidelity where it's cheap (already public).
3. **Locals default to the mock**, tunnel is opt-in only for real-checkout-UI work — avoids webhook-subscription contention entirely.
4. **Keep HMAC verification real** (§4): fixed dev secret *only* for the self-fired mock; the real dev store uses its own real per-store secret. `fixed ⇔ mock, real ⇔ store`.
5. **Prod untouched** — everything gated on `shopifyMockActive()` / `CHECKIN_ENV`, no hardcoded dev domain, no prod branch modified.
