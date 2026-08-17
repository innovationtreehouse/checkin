# Shopify Development Store + Webhooks in Dev/Local

**Status: SHIPPED in part.** The in-process mock landed via #730 (dev route
`api/dev/shopify/orders-paid`, `DEV_MOCK_SHOPIFY_WEBHOOK_SECRET` +
`shopifyMockActive()` gate in `config.ts`, dev UI at `/dev/shopify`); the
registration script landed via #740 (`npm run shopify:webhook` →
`scripts/register-shopify-webhook.ts`). The **real dev store** (ops setup) remains
unbuilt, blocked on O1/O2 below. The prod inbound path was already built and
correct — `api/webhooks/shopify/route.ts` + `withWebhook`/`verifyShopifyHmac`
(`webhookAuth.ts`) + the `config.ts` getters — so "make it real" is store setup +
secret wiring, not new prod code. (This folds in the former separate
implementation-plan doc; its runbook is §2 below. §2/§4/§6 anchors are kept
because code comments and PRODUCTION_PLAN.md cite them.)

**Related:** `docs/ops/contract-signing-mock.md` (sibling in-process mock), #278
(checkout-token honor-system TODO), #624/#625 (order-amount / price-alignment
safety), #683 (Shopify env routed through `config.ts`).

## Load-bearing decisions (the reasons not to undo this)

**Secret pairing (§4) — the #1 cause of 401s, and the decision that governs it.** A
store-admin-created webhook is signed with the **store's webhook signing
secret**; an Admin-API-created one (what `shopify:webhook` creates) is signed
with the **app client secret**. Pick one path, put the matching value in
`SHOPIFY_WEBHOOK_SECRET`. Prod precedent (grep: no `webhooks.json`, no
registration code shipped before #740) means prod's subscription was registered
by hand → prod uses the **store signing secret**; mirror that for the dev store,
and rely on the script only if O2 shows cloud-dev's URL rotates. The Admin API
lists only subscriptions *this app* created, so a hand-registered webhook is
invisible to the script and keeps firing on its own.

**Fixed secret ⇔ self-fired mock; real secret ⇔ real store (§6 — the shipped
in-process mock).** The mock generates
and self-fires its own payload, so `DEV_MOCK_SHOPIFY_WEBHOOK_SECRET` guards
nothing real — it exists only so the timing-safe compare has a value (exactly
Zoho's trick). A real dev store signs with a secret we don't choose, so a fixed
constant would 401 every real webhook. `shopifyWebhookSecret()` returns `null`
when unset (→ handler 500) for the real path — no `config.ts` fallback there;
leave it.

**Variant id is configuration, never hardcoded.** The recurring review question
"how can variant ids in our code align with a real store's?" is moot: the id
lives in `BoardSettings.orgMembershipVariantId`, set once per environment via
`settings/membership`. For the mock it's just a correlation token the handler
echoes and re-matches against the *same* `BoardSettings` — any string works, a
closed loop. **We deliberately don't seed a placeholder** (O4): a seeded id lands
on shared cloud-dev via dev-dashboard reset and silently fails the real store's
variant-match guard.

**One shared team dev store, owned by cloud-dev** — not per-developer. A store
has one `orders/paid` URL, so two devs tunnelling at once clobber each other;
locals default to the mock (§6 above) and never contend, so the single
subscription belongs to cloud-dev's stable URL. Per-dev stores only for someone
who genuinely needs isolated real-checkout testing — rare.

**Prod safety.** Every dev-only surface is env-gated: `/api/dev/shopify/*` 404s
unless `shopifyMockActive()`, which is false in prod by construction
(`readCheckinEnv()` fails safe to prod). The `NODE_ENV` fuse was eliminated in
the #951 review — every deployed instance runs the production image, so it never
distinguished prod from cloud-dev. The prod webhook path is byte-for-byte
unchanged; this work only adds env values and a gated dev route.

## §2 — Real dev store: what ops has to do (unbuilt)

Create a Shopify development store, install a **custom app** using the **Client
Credentials Grant** (server-to-server, so **no OAuth redirect URL** — the only
URL Shopify calls is the webhook callback). Scopes: `read/write` on
products/orders/inventory/discounts. Wire the four values
(`SHOPIFY_STORE_DOMAIN` / `CLIENT_ID` / `CLIENT_SECRET` / `WEBHOOK_SECRET`) into
**AWS Secrets Manager → ECS task-def `secrets:`** (Terraform lives in the
external infra repo; this app repo needs no change — the getters already read
`process.env`). Register the `orders/paid` subscription (store-admin path,
mirroring prod — see secret-pairing above). Local laptops that want the *real*
checkout UI put a tunnel in front of `localhost:4000` (URL churns each restart →
re-register with `shopify:webhook`); most local work just needs "a paid webhook
lands and activates," which the mock delivers with zero infra.

**Superseded branch:** the original mock branch `claude/wonderful-tesla-621492`
is superseded by #730 — **do not merge it.**

## Open questions / decisions before the real store

- **O1.** Do we own a **Shopify Partner org**? Creating a dev store needs one —
  hard blocker. *(decision + owner needed)*
- **O2.** Is **cloud-dev's URL stable** across redeploy, or does it rotate? If it
  rotates, cloud-dev needs the `shopify:webhook` re-register run on deploy.
  *(needs infra answer)*
- **O4.** Seed `BoardSettings` variant/discount, or leave null + manual one-time
  setup? Recommended: leave null (matches how prod is configured).
- **O5.** Volunteer discount / per-process checkout token (#278) stays
  honor-system; a dev store lets us *test* the flow but doesn't fix the token
  gap — tracked in #278, out of scope here.
