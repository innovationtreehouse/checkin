// Shopify API integration using Client Credentials Grant (post-Jan 2026)
// Tokens expire after 24 hours and are cached in-memory.

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { escapeHtml } from "@/lib/email-templates/base";
import { logIntegrationError } from "@/lib/logger";
import { config } from "@/lib/config";

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Hard per-request deadline for every Shopify call. Without it a hung TCP connection
 * (established, no response) blocks the request worker until the platform timeout; during
 * a Shopify outage that exhausts workers, and the serial variant-creation chain below
 * stalls entirely on one hang. ~20s suits these interactive calls.
 */
const SHOPIFY_FETCH_TIMEOUT_MS = 20_000;

/** Admin API version for every REST call here and in scripts/register-shopify-webhook.ts — bump it in one place. */
export const SHOPIFY_API_VERSION = "2026-01";

/** fetch with a hard timeout that surfaces as a clear error instead of hanging. */
export async function shopifyFetch(input: string, init: RequestInit, label: string): Promise<Response> {
  try {
    return await fetch(input, { ...init, signal: AbortSignal.timeout(SHOPIFY_FETCH_TIMEOUT_MS) });
  } catch (err) {
    if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`${label} timed out after ${SHOPIFY_FETCH_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}

/** @internal - Exported only for test isolation */
export function resetTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

/**
 * Fetches a fresh Admin API access token using the client credentials grant.
 * Caches the token and refreshes ~5 minutes before expiry.
 */
export async function getAccessToken(): Promise<string | null> {
  const storeDomain = config.shopifyStoreDomain();
  const clientId = config.shopifyClientId();
  const clientSecret = config.shopifyClientSecret();

  if (!storeDomain || !clientId || !clientSecret) {
    console.warn("Shopify integration is disabled: Missing SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET in .env");
    return null;
  }

  // Return cached token if still valid (with 5-minute buffer)
  if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
    return cachedToken;
  }

  try {
    const res = await shopifyFetch(`https://${storeDomain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
    }, "Shopify token exchange");

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`Failed to obtain Shopify access token: ${res.status} ${errorText}`);
      cachedToken = null;
      return null;
    }

    const data = await res.json();
    cachedToken = data.access_token;

    // Tokens last 24 hours; cache for 23 hours 55 minutes
    tokenExpiresAt = Date.now() + 23 * 60 * 60 * 1000 + 55 * 60 * 1000;

    console.log("[SHOPIFY] Successfully obtained new access token");
    return cachedToken;
  } catch (error) {
    console.error("Failed to fetch Shopify access token:", error);
    cachedToken = null;
    return null;
  }
}

/**
 * Shared failure path for Shopify write operations: log to IntegrationErrorLog
 * (System Status > Link Status) and best-effort email admins/board. Never
 * throws — callers return false/null regardless of whether this succeeds.
 */
async function reportShopifyFailure(
    operation: string,
    error: unknown,
    context: Record<string, unknown>,
    emailIntroHtml: string,
): Promise<void> {
    await logIntegrationError("shopify", error, { operation, ...context });

    try {
        const admins = await prisma.person.findMany({
            where: {
                OR: [{ isSysadmin: true }, { isBoardMember: true }],
                email: { not: null }
            },
            select: { email: true }
        });

        const emailPromises = admins
            .map(a => a.email)
            .filter((e): e is string => typeof e === 'string' && e.length > 0)
            .map(email =>
                sendEmail(
                    email,
                    "Shopify Integration Error",
                    `<p>${emailIntroHtml}</p><p>Error details:</p><pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>`
                )
            );

        if (emailPromises.length > 0) {
            await Promise.all(emailPromises);
        }
    } catch (dbError) {
        console.error("Failed to send Shopify error notifications:", dbError);
    }
}

/**
 * Set the initial absolute inventory (== maxParticipants) for one variant's
 * inventory_item_id. A capped program's variant is created inline with
 * inventory_management='shopify' + inventory_policy='deny' and Shopify's default
 * 0 available, so WITHOUT this the storefront immediately shows "Sold out". This
 * call is the only thing that lifts it off zero.
 *
 * Hardened against the two real-store failure modes that previously left products
 * silently sold out:
 *   - `/locations.json` returns deactivated + fulfillment-service locations in an
 *     arbitrary order; setting at an inactive one 422s. We pick an ACTIVE location,
 *     not blindly `locations[0]`.
 *   - a freshly-created inventory item is often not stocked at that location yet,
 *     so REST `set` 422s ("not stocked at location"). We `connect` it, then retry.
 *
 * Still never throws (a failure must not undo the created variant), but now RETURNS
 * whether stock was actually set and SURFACES failures to IntegrationErrorLog
 * (System Status → Link Status) — a sold-out product is visible instead of silent.
 */
async function setInitialShopifyInventory(
    storeDomain: string,
    accessToken: string,
    inventoryItemId: number | undefined,
    quantity: number,
    label: string,
): Promise<boolean> {
    const jsonHeaders = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': accessToken };
    try {
        if (!inventoryItemId) {
            // The product-create response carried no inventory_item_id for this tracked
            // variant, so we can't set stock — it would ship sold out. Surface it.
            await logIntegrationError("shopify", new Error(`Variant '${label}' has no inventory_item_id; cannot set initial stock (product would be sold out)`), { operation: "setInitialShopifyInventory", label, quantity });
            return false;
        }

        const locRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/locations.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken },
        }, "Shopify get locations");
        if (!locRes.ok) {
            await logIntegrationError("shopify", new Error(`locations.json returned ${locRes.status}`), { operation: "setInitialShopifyInventory", label, quantity });
            return false;
        }

        const locData = await locRes.json();
        const locations: Array<{ id?: number; active?: boolean }> = locData.locations ?? [];
        // Prefer an active location; `locations[0]` may be a deactivated or
        // fulfillment-service location that `set` can't write to.
        const locationId = (locations.find((l) => l.active !== false) ?? locations[0])?.id;
        if (!locationId) {
            await logIntegrationError("shopify", new Error("no Shopify location available to set inventory"), { operation: "setInitialShopifyInventory", label, quantity });
            return false;
        }

        // CONNECT FIRST, unconditionally (credit: @dkaygithub, #985). A variant freshly
        // minted with inventory_management:'shopify' is tracked but not yet *stocked* at
        // any location, and `set` does NOT reliably auto-connect it — it 422s ("not
        // stocked at the location"). Connecting first creates the inventory level (at 0)
        // so the `set` below can write the absolute quantity.
        //
        // Deliberately not "optimistic set, connect+retry on 422": that costs an extra
        // round trip on every capped create (the 422 is the norm for a new item, not the
        // exception) and, worse, makes the whole fix hinge on Shopify returning exactly
        // 422 — a different status and the product silently ships sold out again.
        // A 422 HERE just means the level already exists (e.g. a re-sync) → fall through.
        const connectRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/connect.json`, {
            method: 'POST',
            headers: jsonHeaders,
            body: JSON.stringify({ location_id: locationId, inventory_item_id: inventoryItemId }),
        }, "Shopify connect inventory");
        if (!connectRes.ok && connectRes.status !== 422) {
            const connectBody = await connectRes.text();
            console.error(`[SHOPIFY] Failed to connect inventory item to location: ${connectRes.status}`, connectBody);
            await logIntegrationError("shopify", new Error(`inventory_levels/connect returned ${connectRes.status}: ${connectBody}`), { operation: "setInitialShopifyInventory", label, quantity, locationId });
            return false;
        }

        const setUrl = `https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`;
        const setBody = JSON.stringify({ location_id: locationId, inventory_item_id: inventoryItemId, available: quantity });
        const invRes = await shopifyFetch(setUrl, { method: 'POST', headers: jsonHeaders, body: setBody }, "Shopify set inventory");

        if (invRes.ok) {
            console.log(`[SHOPIFY] Set inventory for variant ${label} to ${quantity} at location ${locationId}`);
            return true;
        }
        const errBody = await invRes.text();
        console.error(`[SHOPIFY] Failed to set inventory: ${invRes.status}`, errBody);
        await logIntegrationError("shopify", new Error(`inventory_levels/set returned ${invRes.status}: ${errBody}`), { operation: "setInitialShopifyInventory", label, quantity, locationId });
        return false;
    } catch (invErr) {
        console.error("Failed to set Shopify inventory level:", invErr);
        await logIntegrationError("shopify", invErr, { operation: "setInitialShopifyInventory", label, quantity });
        return false;
    }
}

export async function createShopifyProgramVariants(name: string, orgMemberPriceCents: number | null, nonOrgMemberPriceCents: number | null, maxParticipants: number | null = null) {
  // ENV GATE: LOCAL ONLY (shopifyMockActive() ⇔ CHECKIN_ENV=local). No real store,
  // so synthesize the variant ids the real store would return — otherwise a paid
  // program stores null variants and the checkout → webhook path can't match. Only
  // priced tiers get a variant, exactly like the real (dev/prod) branch below. Ids
  // need not be globally unique: the inbound handler resolves the program by id, then
  // matches line-items against that program's own variant set. dev/prod fall through
  // to the real Shopify Admin API call below.
  if (config.shopifyMockActive()) {
    const slug = name.replace(/\W+/g, "-").toLowerCase().slice(0, 24);
    return {
      shopifyProductId: `dev-mock-product-${slug}`,
      shopifyOrgMemberVariantId: orgMemberPriceCents && orgMemberPriceCents > 0 ? `dev-mock-variant-member-${slug}` : null,
      shopifyNonOrgMemberVariantId: nonOrgMemberPriceCents && nonOrgMemberPriceCents > 0 ? `dev-mock-variant-nonmember-${slug}` : null,
    };
  }

  const storeDomain = config.shopifyStoreDomain();
  const accessToken = await getAccessToken();

  if (!storeDomain || !accessToken) {
    console.warn("Shopify integration is disabled: Missing credentials or unable to obtain access token");
    return null;
  }

  // Hoisted so the catch can name an orphaned product (created, but variants/DB failed) for manual cleanup.
  let productId: string | number | null = null;

  try {
    // Determine product title
    const productTitle = `Program Enrollment: ${name}`;

    // Variants go INLINE in the product-create call. Creating the product bare
    // makes Shopify mint a "Default Title" variant (price $0, requires_shipping
    // true), which then collides with any follow-up POST /variants.json that
    // doesn't set a distinct option1 (422 "The variant 'Default Title' already
    // exists") AND leaves a physical $0 variant on the product so checkout asks
    // for a shipping address. Inline variants replace the default entirely.
    const variants = [];

    if (orgMemberPriceCents !== null && orgMemberPriceCents > 0) {
        variants.push({
            option1: "Member",
            price: (orgMemberPriceCents / 100).toFixed(2),
            requires_shipping: false,
            inventory_management: maxParticipants ? 'shopify' : null,
            inventory_policy: maxParticipants ? 'deny' : 'continue',
        });
    }

    if (nonOrgMemberPriceCents !== null && nonOrgMemberPriceCents > 0) {
        variants.push({
            option1: "Non-Member",
            price: (nonOrgMemberPriceCents / 100).toFixed(2),
            requires_shipping: false,
            inventory_management: maxParticipants ? 'shopify' : null,
            inventory_policy: maxParticipants ? 'deny' : 'continue',
        });
    }

    const productRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        product: {
          title: productTitle,
          status: 'active',
          product_type: "Educational Services",
          ...(variants.length > 0 ? { options: [{ name: "Membership Type" }], variants } : {}),
        }
      })
    }, "Shopify create product");

    if (!productRes.ok) {
        const errorData = await productRes.text();
        console.error(`[Shopify API Error] ${productRes.status} ${productRes.statusText}`, errorData);
        throw new Error(`Shopify API responded with status: ${productRes.status}`);
    }

    const productData = await productRes.json();
    productId = productData.product.id;

    let memberVariantId: string | null = null;
    let nonMemberVariantId: string | null = null;

    for (const created of productData.product.variants ?? []) {
        if (created.option1 === "Member") {
            memberVariantId = created.id.toString();
        } else if (created.option1 === "Non-Member") {
            nonMemberVariantId = created.id.toString();
        } else {
            continue; // e.g. a default variant on the no-priced-tiers path — nothing to track
        }

        // Set inventory level if maxParticipants is configured
        if (maxParticipants) {
            await setInitialShopifyInventory(storeDomain, accessToken, created.inventory_item_id, maxParticipants, created.option1);
        }
    }

    return {
        shopifyProductId: productId!.toString(),
        shopifyOrgMemberVariantId: memberVariantId,
        shopifyNonOrgMemberVariantId: nonMemberVariantId
    };

  } catch (error) {
    console.error("[Shopify Error] Failed to create product/variants:", error);
    if (productId) {
        console.error("[Shopify] Orphaned product after variant failure, manual cleanup needed:", productId);
    }

    await reportShopifyFailure(
        "createShopifyProgramVariants",
        error,
        { program: name, orphanedProductId: productId ?? null },
        `An error occurred in the Shopify integration while creating variants for program: <strong>${escapeHtml(name)}</strong>.`,
    );

    // We log it but do not crash the app. Admin will need to create variants manually.
    return null;
  }
}

/**
 * Single-pool model (product decision 2026-07-06): mints ONE Shopify variant
 * per program, priced at the base/non-member rate — inventory IS the whole
 * program capacity, not a per-tier pool. Members buy the same variant and get
 * a per-enrollee discount code at checkout (see {@link mintMemberDiscountCode})
 * instead of a separate variant/pool. This is the creation path for NEW
 * programs going forward; {@link createShopifyProgramVariants} above stays
 * only for programs already on the legacy two-variant model — sync-shopify's
 * repair route picks between the two based on whether a program already has a
 * legacy variant configured (expand-only transition; see prisma/schema.prisma).
 */
export async function createShopifySingleVariantProgram(
    name: string,
    basePriceCents: number | null,
    maxParticipants: number | null = null,
): Promise<{ shopifyProductId: string; shopifyVariantId: string } | null> {
    if (!basePriceCents || basePriceCents <= 0) return null; // free program: no Shopify object needed

    // See createShopifyProgramVariants above for why this branch exists (CHECKIN_ENV=local mock).
    if (config.shopifyMockActive()) {
        const slug = name.replace(/\W+/g, "-").toLowerCase().slice(0, 24);
        return {
            shopifyProductId: `dev-mock-product-${slug}`,
            shopifyVariantId: `dev-mock-variant-${slug}`,
        };
    }

    const storeDomain = config.shopifyStoreDomain();
    const accessToken = await getAccessToken();

    if (!storeDomain || !accessToken) {
        console.warn("Shopify integration is disabled: Missing credentials or unable to obtain access token");
        return null;
    }

    // Hoisted so the catch can name an orphaned product (created, but variant/DB failed) for manual cleanup.
    let productId: string | number | null = null;

    try {
        // The variant goes INLINE in the product-create call. Creating the
        // product bare makes Shopify mint a "Default Title" variant (price $0,
        // requires_shipping true), and the follow-up POST /variants.json —
        // which has no option1 either — collides with it (422 "The variant
        // 'Default Title' already exists"). Net effect of the old two-call
        // shape: no variant id ever stored, and the orphaned product kept its
        // physical $0 default variant so checkout demanded a shipping address.
        const productRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/products.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({
                product: {
                    title: `Program Enrollment: ${name}`,
                    status: 'active',
                    product_type: "Educational Services",
                    variants: [{
                        price: (basePriceCents / 100).toFixed(2),
                        requires_shipping: false,
                        inventory_management: maxParticipants ? 'shopify' : null,
                        inventory_policy: maxParticipants ? 'deny' : 'continue',
                    }],
                }
            })
        }, "Shopify create product");

        if (!productRes.ok) {
            const errorData = await productRes.text();
            console.error(`[Shopify API Error] ${productRes.status} ${productRes.statusText}`, errorData);
            throw new Error(`Shopify API responded with status: ${productRes.status}`);
        }

        const productData = await productRes.json();
        productId = productData.product.id;

        // Unlike the legacy path, the single variant is the whole point here —
        // without its id the program can never match a webhook line-item, so a
        // missing variant is a hard failure (the catch names the orphan).
        const variant = productData.product.variants?.[0];
        if (!variant?.id) {
            throw new Error("Shopify product creation response is missing the created variant");
        }
        const variantId = variant.id.toString();

        if (maxParticipants) {
            await setInitialShopifyInventory(storeDomain, accessToken, variant.inventory_item_id, maxParticipants, "Standard");
        }

        return {
            shopifyProductId: productId!.toString(),
            shopifyVariantId: variantId,
        };
    } catch (error) {
        console.error("[Shopify Error] Failed to create single-variant product:", error);
        if (productId) {
            console.error("[Shopify] Orphaned product after variant failure, manual cleanup needed:", productId);
        }

        await reportShopifyFailure(
            "createShopifySingleVariantProgram",
            error,
            { program: name, orphanedProductId: productId ?? null },
            `An error occurred in the Shopify integration while creating the variant for program: <strong>${escapeHtml(name)}</strong>.`,
        );

        return null;
    }
}

/**
 * Shopify is the source of truth for program capacity (product decision 2026-07-06):
 * cap edits and the scholarship lifecycle (apply/refuse) propagate as relative
 * inventory adjustments. Called from PATCH /api/programs/[id] (maxParticipants
 * edits), POST /api/programs/[id]/request-payment-plan (apply, -1), and
 * POST /api/finance-ops/payment-plans/refuse (refusal, +1) — approval performs
 * NO Shopify operation (the applicant already holds the seat since apply-time).
 *
 * Single-pool preference: when `shopifyVariantId` is set (the single-pool
 * model), it IS the program's whole capacity and is the only id adjusted —
 * the legacy pair is ignored even if stale values linger on the row. Legacy
 * (two-variant) programs fall through to the pre-existing both-pools behavior.
 *
 * RELATIVE (inventory_levels/adjust, `available_adjustment: delta`) is deliberate,
 * not absolute set: Shopify decrements `available` itself as seats sell, and an
 * absolute set here would require reconstructing how many seats already sold to
 * avoid clobbering that ledger. A relative delta rides on top of whatever
 * Shopify already has without the app needing to know that number.
 *
 * The schema doesn't persist inventory_item_id (only the variant id), so it's
 * resolved here per call via GET .../variants/{id}.json — one extra round trip per
 * configured variant, acceptable for an admin/scholarship-triggered edit.
 *
 * Never throws: mirrors createShopifyProgramVariants' failure handling (log +
 * admin email), returns false so the caller can surface a non-fatal warning.
 */
export async function adjustProgramInventory(
    program: {
        shopifyVariantId?: string | null;
        shopifyOrgMemberVariantId: string | null;
        shopifyNonOrgMemberVariantId: string | null;
    },
    delta: number,
): Promise<boolean> {
    const variantIds = program.shopifyVariantId
        ? [program.shopifyVariantId]
        : [program.shopifyOrgMemberVariantId, program.shopifyNonOrgMemberVariantId].filter((id): id is string => !!id);

    if (variantIds.length === 0) return true;

    // See createShopifyProgramVariants for why this branch exists (CHECKIN_ENV=local mock).
    if (config.shopifyMockActive()) {
        console.log(`[SHOPIFY] (mock) Would adjust inventory by ${delta} for variants: ${variantIds.join(", ")}`);
        return true;
    }

    const storeDomain = config.shopifyStoreDomain();
    const accessToken = await getAccessToken();

    if (!storeDomain || !accessToken) {
        console.warn("Shopify integration is disabled: Missing credentials or unable to obtain access token");
        return false;
    }

    try {
        // Store's primary location — same lookup pattern as createShopifyProgramVariants.
        const locRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/locations.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken },
        }, "Shopify get locations");
        if (!locRes.ok) throw new Error(`Shopify locations lookup failed: ${locRes.status}`);
        const locData = await locRes.json();
        const locationId = locData.locations?.[0]?.id;
        if (!locationId) throw new Error("Shopify store has no locations configured");

        for (const variantId of variantIds) {
            const variantRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/variants/${variantId}.json`, {
                headers: { 'X-Shopify-Access-Token': accessToken },
            }, "Shopify get variant");
            if (!variantRes.ok) throw new Error(`Shopify variant lookup failed for ${variantId}: ${variantRes.status}`);
            const variantData = await variantRes.json();
            const inventoryItemId = variantData.variant?.inventory_item_id;
            if (!inventoryItemId) throw new Error(`Shopify variant ${variantId} has no inventory_item_id`);

            const adjustRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/adjust.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({
                    location_id: locationId,
                    inventory_item_id: inventoryItemId,
                    available_adjustment: delta,
                }),
            }, "Shopify adjust inventory");
            if (!adjustRes.ok) {
                throw new Error(`Shopify inventory adjust failed for variant ${variantId}: ${adjustRes.status} ${await adjustRes.text()}`);
            }

            console.log(`[SHOPIFY] Adjusted inventory for variant ${variantId} by ${delta} at location ${locationId}`);
        }

        return true;
    } catch (error) {
        console.error("[Shopify Error] Failed to adjust program inventory:", error);

        await reportShopifyFailure(
            "adjustProgramInventory",
            error,
            {
                shopifyVariantId: program.shopifyVariantId ?? null,
                shopifyOrgMemberVariantId: program.shopifyOrgMemberVariantId,
                shopifyNonOrgMemberVariantId: program.shopifyNonOrgMemberVariantId,
                delta,
            },
            `Failed to adjust Shopify inventory (delta ${delta}) after a program capacity change.`,
        );

        return false;
    }
}

/**
 * Mints a server-side, single-use fixed-amount discount code for one
 * enrollee's checkout. Single-pool programs ({@link Program.shopifyVariantId})
 * sell at the base/non-member price; an ACTIVE org member gets this code
 * appended to their cart link (`?discount=<code>`) to bring the price down to
 * the member rate. Interim mechanism —
 * docs/designs/SHOPIFY_MEMBER_SEGMENT_PRICING.md's segment-gated automatic
 * discount (its §5) is the planned upgrade once checkout identity is solved;
 * this mints one real Shopify object per checkout in the meantime.
 *
 * ponytail: one Price Rule + Discount Code per enrollee/checkout — fine at
 * Treehouse's program-enrollment volume. Upgrade to the segment design above
 * if that stops being true.
 *
 * Never throws: a failure returns null so the caller falls back to an
 * undiscounted checkout link rather than blocking it (member pays full price
 * and can contact the board — better than a broken checkout).
 */
export async function mintMemberDiscountCode(
    programId: number,
    variantId: string,
    amountOffCents: number,
): Promise<string | null> {
    if (amountOffCents <= 0) return null;

    const code = `PRG${programId}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // See createShopifyProgramVariants above for why this branch exists (CHECKIN_ENV=local mock).
    if (config.shopifyMockActive()) {
        console.log(`[SHOPIFY] (mock) Would mint discount code ${code} for program ${programId} (-$${(amountOffCents / 100).toFixed(2)})`);
        return code;
    }

    const storeDomain = config.shopifyStoreDomain();
    const accessToken = await getAccessToken();

    if (!storeDomain || !accessToken) {
        console.warn("Shopify integration is disabled: Missing credentials or unable to obtain access token");
        return null;
    }

    try {
        const startsAt = new Date();
        const endsAt = new Date(startsAt.getTime() + 48 * 60 * 60 * 1000); // ~48h, per design

        const priceRuleRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/price_rules.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({
                price_rule: {
                    title: code,
                    target_type: 'line_item',
                    target_selection: 'entitled',
                    entitled_variant_ids: [Number(variantId)],
                    // 'each' applies the amount PER UNIT: a member household enrolling
                    // N kids buys quantity N of the variant, and each seat gets the
                    // member price ('across' would subtract the amount once from the
                    // whole line, overcharging N-1 seats).
                    allocation_method: 'each',
                    value_type: 'fixed_amount',
                    value: `-${(amountOffCents / 100).toFixed(2)}`,
                    customer_selection: 'all',
                    usage_limit: 1,
                    once_per_customer: true,
                    starts_at: startsAt.toISOString(),
                    ends_at: endsAt.toISOString(),
                },
            }),
        }, "Shopify create price rule");
        if (!priceRuleRes.ok) {
            throw new Error(`Shopify price rule creation failed: ${priceRuleRes.status} ${await priceRuleRes.text()}`);
        }
        const priceRuleData = await priceRuleRes.json();
        const priceRuleId = priceRuleData.price_rule?.id;
        if (!priceRuleId) throw new Error("Shopify price rule response missing id");

        const codeRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/price_rules/${priceRuleId}/discount_codes.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ discount_code: { code } }),
        }, "Shopify create discount code");
        if (!codeRes.ok) {
            throw new Error(`Shopify discount code creation failed: ${codeRes.status} ${await codeRes.text()}`);
        }

        console.log(`[SHOPIFY] Minted single-use discount code ${code} for program ${programId} (-$${(amountOffCents / 100).toFixed(2)}, expires ${endsAt.toISOString()})`);
        return code;
    } catch (error) {
        console.error("[Shopify Error] Failed to mint member discount code:", error);
        // Quieter than reportShopifyFailure (no admin email): a per-checkout mint
        // failure degrades gracefully to an undiscounted link (never blocks
        // checkout) rather than signaling a structural integration break —
        // logged for Link Status visibility, not urgent enough to page the board
        // every time.
        await logIntegrationError("shopify", error, {
            operation: "mintMemberDiscountCode",
            programId,
            variantId,
            amountOffCents,
        });
        return null;
    }
}
