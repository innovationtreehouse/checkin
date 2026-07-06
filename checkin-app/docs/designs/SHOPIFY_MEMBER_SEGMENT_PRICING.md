# Shopify Member-Segment Pricing

**Status:** Proposal — for review. No code written.
**Author:** design pass, 2026-07-06 (grepped `src/`, `prisma/schema.prisma`, and open issues before writing; see §0)
**Addresses:** #270 (member-segment allowlist for program pricing), and by extension #278 (volunteer discount honor-system — its own "long-term fix" checklist is what this doc designs)
**Related:** #739 (webhook variant-match guard this proposal simplifies — see §3), #625 (dues/price-alignment drift, referenced in `payment.ts`), [`SHOPIFY_DEV_STORE_WEBHOOK.md`](./SHOPIFY_DEV_STORE_WEBHOOK.md) (dev-store setup + mock architecture this proposal reuses and extends), a parallel companion effort making Shopify inventory the source of truth for program capacity (context for §3's single-variant consequence)

> A note on naming, since the sibling doc above got called out for it: the status line above is accurate. This document proposes nothing has landed; it is not implemented in part, and no PR against `main` should claim otherwise until code exists.

---

## 0. Scope check — what already exists

Confirmed by grep before writing this: **no customer, tag, or segment code exists anywhere in `src/`.** `grep -rn "customer" src/lib/shopify.ts` returns nothing; the Shopify integration today only creates Products/Variants (`createShopifyProgramVariants`) and consumes inbound `orders/paid` webhooks. Two TODOs already point at exactly this gap:

- [`payment.ts:73–79`](../../src/lib/membership/payment.ts#L73-L79) — `TODO(#278): ... gate the coupon to an auto-managed Shopify customer segment of volunteer households so Shopify enforces who can redeem it.`
- [`webhooks/shopify/route.ts:82–92`](../../src/app/api/webhooks/shopify/route.ts#L82-L92) — the same TODO restated on the inbound side, plus: "the volunteer discount code is still a self-serve code on a public cart link rather than gated to a Shopify customer segment."

So this is greenfield design work closing a gap the code already names but doesn't fix. Nothing here contradicts or duplicates in-flight work — the only adjacent PRs are #739 (merged: the variant-*presence* guard this doc's §3 explains the limits of) and the capacity/inventory companion effort (unmerged, referenced only for the consequence it shares with this proposal in §3).

---

## 1. Current state (as wired today)

### 1.1 Program pricing — two variants, client-side tier selection

Each `Program` carries **two** Shopify variants and two prices ([`schema.prisma:679–689`](../../prisma/schema.prisma)):

```
orgMemberPriceCents        Int?
nonOrgMemberPriceCents     Int?
shopifyOrgMemberVariantId    String?
shopifyNonOrgMemberVariantId String?
```

Both variants are created together at program-creation time by [`createShopifyProgramVariants`](../../src/lib/shopify.ts#L96) — one Shopify Product, one variant per priced tier.

The buyer's enrollment page picks which variant to check out **client-side**, based on the household's own self-reported membership fetched over `/api/household` ([`programs/[id]/page.tsx:244–249`](../../src/app/programs/[id]/page.tsx#L244-L249)):

```ts
const householdRes = await fetch('/api/household');
let isMember = false;
if (householdRes.ok) {
  const householdData = await householdRes.json();
  isMember = householdData.household?.orgMembership?.status === "ACTIVE" || false;
}
variantId = isMember ? program.shopifyOrgMemberVariantId : program.shopifyNonOrgMemberVariantId;
```

The resulting cart permalink ([`enroll.ts:53–61`](../../src/app/programs/[id]/enroll.ts#L53-L61)) is:

```
https://{store}/cart/{variantId}:{qty}?attributes[CheckMeIn_Account_ID]={ids}&attributes[Program_ID]={programId}
```

**The honor-system hole (#270):** nothing stops a browser from hand-building this same URL with `program.shopifyOrgMemberVariantId` instead of the non-member one — the variant choice is a client-side `if`, not a server check. `#739` (merged) closed the *adjacent* hole — the webhook now verifies the paid order actually contains **one of the program's own variants** ([`webhooks/shopify/route.ts:140–166`](../../src/app/api/webhooks/shopify/route.ts#L140-L166)):

```ts
const programVariantIds = new Set(
    [program?.shopifyOrgMemberVariantId, program?.shopifyNonOrgMemberVariantId].filter(...)
);
const hasProgramItem = (order.line_items ?? []).some((li) => programVariantIds.has(String(li.variant_id)));
```

— but by design this only proves *a* program variant matched, **not the right tier for the buyer**. A non-member who pays the member-variant price passes this check cleanly; #739's own PR description scopes it as a price-integrity fix, not a tier-entitlement fix. That gap is #270, and it is structural: as long as tier selection is a client-side toggle over two publicly-checkoutable variants, no server-side check on the *order* can recover who was *entitled* to which variant — the entitlement decision has to move to a point Shopify itself enforces before checkout completes. That's this proposal.

### 1.2 Membership dues + volunteer discount — the #278 twin

Every household pays through **one** membership variant (`BoardSettings.orgMembershipVariantId`); volunteer households additionally get a **discount code** string appended to the same public cart permalink ([`payment.ts:37–47`](../../src/lib/membership/payment.ts#L37-L47), [`BoardSettings.volunteerDiscountCode`](../../prisma/schema.prisma#L441)):

```ts
export function buildMembershipCheckoutUrl(storeDomain, variantId, processId, discountCode) {
    const parts = [];
    if (discountCode) parts.push(`discount=${encodeURIComponent(discountCode)}`);
    parts.push(`attributes[Membership_Process_ID]=${processId}`);
    return `https://${storeDomain}/cart/${variantId}:1?${parts.join("&")}`;
}
```

Because the code is just a string appended to a public URL, anyone who sees it (a screenshot, a forwarded email, a shared link) can reuse it — #278 names this exactly. The inbound webhook validates that the order contains the membership product (H2, same shape as #739) but never validates the discount code itself, per #278's problem statement.

### 1.3 The identity-at-checkout problem — the central design constraint

Both of the above share one root cause: **checkout is an anonymous Shopify cart permalink.** `https://{store}/cart/{variant}:{qty}?discount=...&attributes[...]` has no notion of *who* is buying — it is a bare URL anyone can open. Cart attributes (`Membership_Process_ID`, `CheckMeIn_Account_ID`, `Program_ID`) are customer-controlled query-string values, not authenticated claims; that's precisely why #739's and #278's guards exist and why they're still incomplete.

This matters enormously for the proposal below, because **Shopify customer segments only apply where checkout is associated with an identified Shopify customer who is a member of that segment.** A segment defined as `customer_tags CONTAINS 'org-member'` (or targeted by a segment-restricted automatic discount) is evaluated against **the customer attached to the checkout** — not against anything in the cart URL, and (per Shopify's documented discount-eligibility model) generally **not against a guest checkout**, even one with a prefilled email. An anonymous cart permalink, by itself, is never "a member" to Shopify — no matter how the segment or discount is configured on the Shopify side.

So: tagging members in Shopify (this proposal's core mechanism) and gating pricing to that segment does **not** by itself fix anything unless checkout also identifies the buyer as that tagged customer. §5 confronts this directly; it is the crux of the whole design and everything else here is secondary to it.

---

## 2. Proposal component 1 — Member registry → Shopify

**App is the writer; Shopify segment membership is derived state**, computed from a live tag sync, never edited by hand in Shopify.

### Mechanism

- Define the segment(s) in Shopify (admin UI, once): `customer_tags CONTAINS 'org-member'` and `customer_tags CONTAINS 'volunteer'`.
- On every event that changes `OrgMembership.status` or `OrgMembership.isVolunteer`, upsert a Shopify Customer (search-by-email, create-if-absent) for **every household member with a non-null email** and add/remove the corresponding tag(s).

### Hook points (all existing, all found by grep — no new lifecycle needed)

| Event | Where | What changes |
|---|---|---|
| Payment activates membership | [`activate()`, `payment.ts:203–210`](../../src/lib/membership/payment.ts#L203-L210) — flips `OrgMembership.status = "ACTIVE"` | add `org-member` tag |
| Board manually grants/restores | [`membership-ops/households/route.ts:150–155`](../../src/app/api/membership-ops/households/route.ts#L150-L155) — `if (active)` branch | add `org-member` tag |
| Board revokes | [same file, :169–174](../../src/app/api/membership-ops/households/route.ts#L169-L174) — `ACTIVE → REVOKED` | remove `org-member` tag |
| Board denies household | [same file, :112–130](../../src/app/api/membership-ops/households/route.ts#L112-L130) — `deny` branch, `→ DENIED`/`NONE` | remove `org-member` tag |
| Volunteer status set (sticky/additive) | [`review.ts:336–344`](../../src/lib/membership/review.ts#L336-L344) — `OrgMembership.isVolunteer = true` during background-check clearance | add `volunteer` tag |

There is currently **no path that un-sets `isVolunteer`** (it's documented as sticky/additive) — so no "remove volunteer tag" hook exists today either; that's a pre-existing product decision, not something this proposal needs to change.

### Whose email — a real wrinkle, not an edge case

`OrgMembership` belongs to `Household` ([`schema.prisma:314–331`](../../prisma/schema.prisma#L314-L331)), not to a `Person`. A household can have several `Person` rows with independent, nullable emails ([`Person.email`, `schema.prisma:68`](../../prisma/schema.prisma#L68)) — `HouseholdLead` ([`schema.prisma:229–239`](../../prisma/schema.prisma#L229-L239)) marks which adults manage the household, but any household member, lead or not, may have their own email and may be the one who ends up buying. **Tag every household member with a non-null email**, not just leads — whichever family member's Shopify identity ends up at checkout needs to already be tagged. (Minors typically have no email at all and never check out themselves — see §7.)

### Implementation shape

New module, e.g. `lib/membership/shopifyCustomerSync.ts`, reusing `shopify.ts`'s existing `getAccessToken` / `shopifyFetch` / `SHOPIFY_API_VERSION` — no new Admin API client. Roughly: search customer by email → create if absent → PUT tags (union add/remove, don't clobber unrelated tags a merchant may have set by hand).

**Failure handling:** best-effort, non-blocking, same posture as `createShopifyProgramVariants`'s existing failure path ([`shopify.ts:247–289`](../../src/lib/shopify.ts#L247-L289) — log via `logIntegrationError`, email admins, **do not** fail the underlying operation). A Shopify outage must never block `activate()` from flipping a membership ACTIVE. That means tag-sync can drift — which is exactly why:

**Reconciliation job:** a new nightly cron, same shape as the existing sweep pattern ([`cron/membership-renewals/route.ts`](../../src/app/api/cron/membership-renewals/route.ts) → `runRenewalSweep`, or the broader nightly reconciliation already done in [`cron/nightly/route.ts`](../../src/app/api/cron/nightly/route.ts)). It diffs "households with `OrgMembership.status = ACTIVE` (+ `isVolunteer`)" against Shopify customers currently carrying `org-member`/`volunteer`, applies missing tags, removes stale ones for households no longer active, and alerts the board (mirrors `notifyBoardPaidReject`/`boardAlerts.ts`, already used in `payment.ts`) if drift exceeds a sane threshold (repeated failures, not routine one-offs from the batch's own timing).

---

## 3. Proposal component 2 — Program pricing

**One variant per program, priced at the non-member rate.** A segment-gated **automatic discount** (no code to enter) applies at checkout for buyers Shopify recognizes as `org-member`. Discount value = `nonOrgMemberPriceCents − orgMemberPriceCents` for that program.

Two shapes worth naming (both fully supported by Shopify's Admin GraphQL discount API — `write_discounts` scope, already listed in the dev-store doc, covers either):

- **Per-program fixed-amount automatic discount** — mirrors today's per-program price pairs exactly (one discount object per program, amount = today's `orgMemberPriceCents` delta). Most direct migration; most Shopify objects to manage (one discount per priced program).
- **One percentage-off rule, segment-gated, applied storewide (or to a program collection)** — a single Shopify object to maintain, but only works cleanly if the member discount is a *consistent percentage* across programs; today's data (independent `orgMemberPriceCents`/`nonOrgMemberPriceCents` per program) suggests it isn't necessarily. Simpler to operate, worse fit for the current per-program pricing freedom.

Recommend the **per-program fixed-amount** shape for parity with current behavior; revisit the percentage rule only if the board later standardizes on a flat member discount rate.

### Consequences

- **Single inventory pool.** Today `createShopifyProgramVariants` sets Shopify inventory **independently per variant** ([`shopify.ts:201–234`](../../src/lib/shopify.ts#L201-L234)): each of the two variants gets `available: maxParticipants`, i.e. Shopify's own inventory system holds *two* pools of the full cap, even though the app's own capacity guard ([`lockProgramAndCheckCapacity`](../../src/lib/program/capacity.ts)) already enforces one combined `maxParticipants` at the DB layer. One variant collapses that to a true single pool in Shopify too — this is exactly the artifact the parallel capacity-source-of-truth effort needs resolved, and this proposal's single-variant end state is what makes Shopify inventory a valid single source of truth for capacity going forward.
- **#739's guard simplifies.** The line-item check in `webhooks/shopify/route.ts` collapses from a two-id `Set` to one variant id — there's only one program variant left to match, so the tier-confusion class of bug (§1.1) is closed by construction, not by a smarter check.
- **Client-side tier selection deletes.** The `/api/household` membership fetch + `isMember` branch in `programs/[id]/page.tsx:240–249` goes away entirely — there's one variant, one link, no client-trusted branch to spoof.
- **PATCH price edits simplify to one field + a discount update.** The program PATCH route's two-price handling ([`programs/[id]/route.ts:151–152`](../../src/app/api/programs/[id]/route.ts#L151-L152)) collapses to updating the single variant's price plus the paired discount's amount via the Admin API (today, price edits don't touch Shopify at all post-creation — `shopifyPriceSyncedAt` exists on `BoardSettings` but nothing currently writes it; this proposal is the first thing that needs a real price-sync call, not just the field).

---

## 4. Proposal component 3 — Membership dues + volunteer discount (#278)

Same mechanism, applied to the membership variant instead of program variants: a `volunteer`-segment-gated automatic discount replaces `BoardSettings.volunteerDiscountCode` and the `discount=<code>` URL parameter.

This retires:
- `buildMembershipCheckoutUrl`'s discount-code branch ([`payment.ts:43–44`](../../src/lib/membership/payment.ts#L43-L44))
- the `TODO(#278)` block in `ensurePaymentLink` ([`payment.ts:73–79`](../../src/lib/membership/payment.ts#L73-L79)) — it becomes dead code once the segment enforces eligibility instead of a shareable string
- `BoardSettings.volunteerDiscountCode` itself, once no code path reads it

No variant surgery is needed here (unlike §3) — membership already checks out through a single variant; only the discount-delivery mechanism changes. This is the smaller of the two migrations and could reasonably ship *before* §3 if sequencing favors landing the cheaper win first.

---

## 5. The identity-at-checkout problem — options

Restating the constraint from §1.3: a segment-gated discount only fires for a checkout Shopify can attribute to a tagged customer. Cart permalinks alone don't do that. Options, in the order the ladder favors them:

**(a) Require Shopify customer sign-in at checkout (Shopify's "new customer accounts" — email + one-time code, no password).** The buyer logs into (or creates) a Shopify customer account using their org-known email — the same email this proposal already tags in §2. Once signed in, Shopify recognizes them as the segment member and the automatic discount applies natively — this is exactly the feature segment-gated discounts are built for.
- *Cost:* near-zero new app code — §2's tag sync is the only thing this needs, plus enabling account-required checkout and defining the discount in Shopify's admin. No new Admin API surface, no new scope beyond what §2/§3 already add.
- *UX cost, stated plainly:* an **extra login step at checkout** — the buyer is already logged into our app, and now has to also authenticate a *separate* Shopify identity (email → verification code) before the discount applies. For a repeat member this is mildly annoying; for a first-time member checking out minutes after joining, it's an unfamiliar extra hoop. This is real friction, not hand-waved away.

**(b) Prefill the checkout email via cart-permalink params and hope guest-checkout still gets segment-matched.** Rejected as a foundation: Shopify's documented discount-eligibility model evaluates segment membership against **the customer attached to the checkout**, and a guest checkout — even with a prefilled or typed email that happens to match a tagged customer record — is not documented to establish that attachment before the discount decision is made. Treat this as **unconfirmed and likely unreliable**, not a fallback to build on. If the team wants to keep this option alive, it needs an empirical spike against the real dev store (§7) before any code is written around it — don't take it on faith either direction.

**(c) App-generated draft orders via the Admin API.** Since our app already knows the buyer's identity (our own login) and already maintains their tagged Shopify Customer record (§2), the app can create a Shopify **Draft Order** assigned to that Customer, let the segment-gated discount apply naturally against a known customer (or apply it explicitly), and send the buyer the draft order's hosted `invoice_url` to pay. This sidesteps the anonymous-cart problem entirely — identity is established server-side, before checkout begins, by the party (us) who actually has it.
- *Cost:* the real build here. New scope (`write_draft_orders`), a new route to create/send the draft order (replacing `buildMembershipCheckoutUrl`/`buildShopifyCheckoutUrl`'s plain permalink), and a shift in the webhook trigger (`orders/paid` off the completed draft order rather than off a raw cart checkout — same downstream `activate()`/participant-ACTIVE handling, different upstream event).
- *UX cost:* smallest of the three real options — no second login, the buyer just gets a checkout link that's already priced correctly for them. But it's a materially bigger build.

**(d) Keep discount codes, but auto-generate a per-checkout single-use code.** No segments, no customer tagging, no identity problem to solve — the app mints a fresh code per checkout link and (optionally) redeems/expires it after use. Kills the *shareability* hole in #278 without touching #270 at all, because program member/non-member pricing is a **variant-selection** problem, not a discount-code problem — this option has nothing to say about §3. Useful only as a narrow, fast #278-only stopgap if the org wants something shipped immediately while segments are built properly.

### Recommendation: (a) primary, (c) fallback

(a) is the "already-installed dependency" rung of the ladder — Shopify segment-gated discounts are *built* to work this way, §2's tag sync is the only prerequisite, and there's no new Admin API surface to design, test, or maintain. Ship it, accept the stated login-friction cost, and see whether it's actually a problem in practice (Bogus-Gateway-style dev-store testing, §7, before committing).

Fall back to (c) only if (a)'s friction proves unacceptable in practice, or if a future need (guest checkout for members, finer server-side control over discount application) makes draft orders worth the bigger build. Don't build (c) speculatively alongside (a) — that's exactly the kind of unrequested flexibility this doc shouldn't ship two of.

(d) is called out as the honest minimal alternative for #278 alone, in case the board wants the shareable-code hole closed on a shorter timeline than the segment work in this doc.

---

## 6. Migration path

| Phase | Scope | Ships | Rollback |
|---|---|---|---|
| **1** | §2 only — tag/segment writer + reconciliation cron | No pricing change, no user-visible change at all | Turn off the writer (env-gate); stale tags in Shopify are harmless since nothing reads them for pricing yet |
| **2** | §3 for **new** programs only | New programs get one variant + automatic discount; existing programs keep their two-variant setup untouched | New programs simply aren't created with the new path (revert the creation code path); no data migration to undo |
| **3** | Migrate **existing** programs to single-variant | Per program: create the new non-member-priced variant + discount, cut enrollment links over, archive (not delete — Shopify variants with historical orders can't be deleted) the old member variant | Re-point enrollment links at the old two-variant setup for that program; the archived member variant is still there, just hidden |
| **4** | §4 — membership dues + volunteer discount | Retire `volunteerDiscountCode` + the `discount=` URL param in favor of the volunteer automatic discount | Re-enable the `discountCode` branch in `buildMembershipCheckoutUrl`; `BoardSettings.volunteerDiscountCode` isn't dropped from the schema until this phase is fully validated |

**In-flight checkouts across phase 3's cutover:** a cart permalink already rendered or emailed before cutover points at the **old** member-tier variant id. Shopify cart permalinks don't expire server-side — that URL stays live indefinitely. Recommend a deprecation window per program: keep the old member variant purchasable at its already-set price for some period after cutover (a week or two, tunable per program's remaining enrollment window), keep the webhook's variant-id `Set` recognizing both old and new variants during that window, and alert the board to manually reconcile any straggling checkout on the old variant after the window closes rather than silently accepting or silently rejecting it.

---

## 7. Open questions

- **Minors / household members without their own email.** A minor participant never checks out themselves — a parent (household lead or otherwise, per §2) buys on their behalf. As long as *that* buying adult's own email is tagged, the minor is a non-issue; nothing here needs a segment identity for the child. Worth confirming this holds for every enrollment path, not just the common one.
- **Household members who aren't leads.** §2 already resolves this by tagging every household member with a non-null email, not just `HouseholdLead` rows — flagging here so a reviewer explicitly signs off on that being the right scope (vs. leads-only, which would silently break for a non-lead adult who happens to be the one at the keyboard).
- **Guest checkout despite (a).** If a member somehow completes checkout as a guest (declines/skips sign-in) under option (a), the segment discount silently doesn't apply — they're charged full non-member price with no error surfaced anywhere. Is that an acceptable failure mode, or does it need a checkout-side nudge / a post-purchase reconciliation-and-refund path? Recommend deciding this before phase 2 ships, not after the first support ticket.
- **Segment propagation delay.** Shopify's own documentation is explicit that segments update automatically but not synchronously — there's a real (if usually short) delay between a customer's tags changing and their segment membership recalculating. Practically, this mostly bites a household mid-program-registration right after their **first** membership payment clears (dues checkout itself is never segment-gated — you're not a member yet when you buy membership, by definition) — if they immediately try to buy a program at member pricing within that propagation window, they could get charged non-member price on their very first eligible purchase. Worth a small "give it a few minutes" note in the confirmation email, at minimum.
- **Dev-store testing — the mock cannot model this feature.** The existing in-process Shopify mock ([`config.ts:95–106`](../../src/lib/config.ts#L95-L106), gated by `shopifyMockActive()`) works by **self-firing a synthesized `orders/paid` payload directly at our own webhook** — it never touches Shopify's real checkout or discount-evaluation engine at all. That engine is exactly what this proposal's core question (§5) lives inside. The mock can still validate everything downstream of the webhook (variant matching, `activate()`, participant activation) with a synthesized order at whatever price/discount we choose to encode — but it **cannot** tell us whether a segment-gated discount actually applies for a real signed-in customer, whether tag-sync latency causes a real miss, or what the checkout-side login/discount UX actually looks like. Recommend promoting real-dev-store checkout testing ([`SHOPIFY_DEV_STORE_WEBHOOK.md`](./SHOPIFY_DEV_STORE_WEBHOOK.md), currently scoped there as valuable-but-not-blocking) to **required** before phase 2 of this proposal ships — this is the one place the mock's zero-infra convenience runs out.

---

## Recommendation summary

1. **Ship §2 (tag/segment writer + reconciliation) first, alone, with no pricing change** — lowest risk, fully reversible, and lets the board/ops verify tag accuracy for real before anything depends on it.
2. **Adopt option (a) — Shopify customer sign-in at checkout — as the primary answer to the identity problem** (§5): it's what segment-gated discounts are natively built for, needs no new Admin API surface beyond §2's tagging, and its cost is an honest, stated UX one (an extra login/code step), not a hidden one. Hold option (c) — app-generated draft orders — in reserve as the fallback if that friction proves unacceptable.
3. **Collapse program pricing to one variant + a per-program automatic discount** (§3) for new programs first, then migrate existing ones with a deprecation window (§6) — this is also what makes Shopify inventory a valid single source of truth for the parallel capacity effort, resolving the current double-pooled-inventory artifact as a side effect, not a separate project.
4. **Retire the volunteer discount code** (§4) the same way, closing #278's honor-system gap by the same mechanism rather than a bespoke one.
5. **Do not build option (b)** (prefilled guest-checkout email) on faith — spike it against the real dev store if anyone wants it kept alive; otherwise let it drop.
6. **Promote real-dev-store checkout testing from optional to required** before phase 2 ships — the in-process mock cannot exercise the one thing this whole proposal hinges on (§7).

Addresses #270. Addresses #278.
