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
 * Best-effort: resolve the store's primary location, then set an absolute
 * inventory level for one inventory_item_id. Used at variant-creation time
 * (both the legacy two-variant path and the single-variant path) where
 * `available` should be exactly maxParticipants. Never throws — a failure
 * here doesn't undo the variant that was just created successfully.
 */
async function setInitialShopifyInventory(
    storeDomain: string,
    accessToken: string,
    inventoryItemId: number,
    quantity: number,
    label: string,
): Promise<void> {
    try {
        const locRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/locations.json`, {
            headers: { 'X-Shopify-Access-Token': accessToken },
        }, "Shopify get locations");
        if (locRes.ok) {
            const locData = await locRes.json();
            const locationId = locData.locations?.[0]?.id;
            if (locationId) {
                const invRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Shopify-Access-Token': accessToken,
                    },
                    body: JSON.stringify({
                        location_id: locationId,
                        inventory_item_id: inventoryItemId,
                        available: quantity,
                    })
                }, "Shopify set inventory");
                if (invRes.ok) {
                    console.log(`[SHOPIFY] Set inventory for variant ${label} to ${quantity} at location ${locationId}`);
                } else {
                    console.error(`[SHOPIFY] Failed to set inventory: ${invRes.status}`, await invRes.text());
                }
            }
        }
    } catch (invErr) {
        console.error("Failed to set Shopify inventory level:", invErr);
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

    // 1. Create Product
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
          options: [{ name: "Membership Type" }]
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

    // 2. Create Variants
    const variants = [];

    if (orgMemberPriceCents !== null && orgMemberPriceCents > 0) {
        variants.push({
            product_id: productId,
            option1: "Member",
            price: (orgMemberPriceCents / 100).toFixed(2),
            requires_shipping: false,
            inventory_management: maxParticipants ? 'shopify' : null,
            inventory_policy: maxParticipants ? 'deny' : 'continue',
        });
    }

    if (nonOrgMemberPriceCents !== null && nonOrgMemberPriceCents > 0) {
        variants.push({
            product_id: productId,
            option1: "Non-Member",
            price: (nonOrgMemberPriceCents / 100).toFixed(2),
            requires_shipping: false,
            inventory_management: maxParticipants ? 'shopify' : null,
            inventory_policy: maxParticipants ? 'deny' : 'continue',
        });
    }

    let memberVariantId: string | null = null;
    let nonMemberVariantId: string | null = null;

    if (variants.length > 0) {
        for (const variant of variants) {
            const variantRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/variants.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({ variant })
            }, "Shopify create variant");

            if (variantRes.ok) {
                const variantData = await variantRes.json();
                if (variant.option1 === "Member") {
                    memberVariantId = variantData.variant.id.toString();
                } else {
                    nonMemberVariantId = variantData.variant.id.toString();
                }

                // Set inventory level if maxParticipants is configured
                if (maxParticipants && variantData.variant.inventory_item_id) {
                    await setInitialShopifyInventory(storeDomain, accessToken, variantData.variant.inventory_item_id, maxParticipants, variant.option1);
                }
            } else {
                console.error("Failed to create Shopify variant:", await variantRes.text());
            }
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

        const variantRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}/variants.json`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({
                variant: {
                    product_id: productId,
                    price: (basePriceCents / 100).toFixed(2),
                    requires_shipping: false,
                    inventory_management: maxParticipants ? 'shopify' : null,
                    inventory_policy: maxParticipants ? 'deny' : 'continue',
                }
            })
        }, "Shopify create variant");

        if (!variantRes.ok) {
            const errorData = await variantRes.text();
            console.error("Failed to create Shopify variant:", errorData);
            throw new Error(`Shopify API responded with status: ${variantRes.status}`);
        }

        const variantData = await variantRes.json();
        const variantId = variantData.variant.id.toString();

        if (maxParticipants && variantData.variant.inventory_item_id) {
            await setInitialShopifyInventory(storeDomain, accessToken, variantData.variant.inventory_item_id, maxParticipants, "Standard");
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
        shopifyArchivedAt?: Date | null;
    },
    delta: number,
): Promise<boolean> {
    // Archived listing (SHOPIFY_LISTING_ARCHIVE.md): the program has NO live
    // Shopify listing, so there is nothing to adjust. This is the single choke
    // point for every relative inventory push — capacity edits, scholarship
    // holds/releases, the webhook's sibling mirror — so one guard here silences
    // them all while archived. Success no-op (true) so callers surface no warning.
    if (program.shopifyArchivedAt) {
        console.log(`[SHOPIFY] Skipping inventory adjust (delta ${delta}): program's Shopify listing is archived.`);
        return true;
    }

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

/**
 * Retire (archive) or restore (un-archive) a program's Shopify LISTING by
 * flipping the product's status (SHOPIFY_LISTING_ARCHIVE.md). `archived: true`
 * → PUT the product to `archived` status (hidden from the storefront, not
 * purchasable, sales history preserved); `archived: false` → restore to
 * `active`. Board/sysadmin action, called from POST /api/programs/[id]/archive-shopify.
 *
 * The product id is normally stored on the program (shopifyProductId); if only
 * variant ids are (possible via the manual-repair PATCH path), it's derived by
 * fetching the variant — mirroring adjustProgramInventory's variant lookup.
 * A program with neither (free program / no listing) is a no-op success.
 *
 * Never throws: mirrors the rest of this module (mock branch, hard fetch
 * timeout, reportShopifyFailure + admin email on failure). Returns false on a
 * real Shopify failure so the caller can archive the checkin side anyway and
 * surface a non-fatal warning (reconcile via retry / the Shopify admin).
 */
export async function setProgramListingArchived(
    program: {
        shopifyProductId: string | null;
        shopifyVariantId?: string | null;
        shopifyOrgMemberVariantId: string | null;
        shopifyNonOrgMemberVariantId: string | null;
    },
    archived: boolean,
): Promise<boolean> {
    const status = archived ? "archived" : "active";
    const anyVariantId = program.shopifyVariantId || program.shopifyOrgMemberVariantId || program.shopifyNonOrgMemberVariantId || null;

    // No product AND no variant → free program / no listing: nothing to act on.
    if (!program.shopifyProductId && !anyVariantId) return true;

    // See createShopifyProgramVariants above for why this branch exists (CHECKIN_ENV=local mock).
    if (config.shopifyMockActive()) {
        console.log(`[SHOPIFY] (mock) Would set product status to ${status} for program listing (product ${program.shopifyProductId ?? "?"}).`);
        return true;
    }

    const storeDomain = config.shopifyStoreDomain();
    const accessToken = await getAccessToken();

    if (!storeDomain || !accessToken) {
        console.warn("Shopify integration is disabled: Missing credentials or unable to obtain access token");
        return false;
    }

    try {
        // Resolve the product id: stored id if present, else derive from a variant.
        let productId = program.shopifyProductId;
        if (!productId && anyVariantId) {
            const variantRes = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/variants/${anyVariantId}.json`, {
                headers: { 'X-Shopify-Access-Token': accessToken },
            }, "Shopify get variant");
            if (!variantRes.ok) throw new Error(`Shopify variant lookup failed for ${anyVariantId}: ${variantRes.status}`);
            const variantData = await variantRes.json();
            productId = variantData.variant?.product_id ? String(variantData.variant.product_id) : null;
        }
        if (!productId) return true; // variant carried no product_id — nothing to act on.

        const res = await shopifyFetch(`https://${storeDomain}/admin/api/${SHOPIFY_API_VERSION}/products/${productId}.json`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': accessToken,
            },
            body: JSON.stringify({ product: { id: Number(productId), status } }),
        }, "Shopify update product status");
        if (!res.ok) {
            throw new Error(`Shopify product status update failed for ${productId}: ${res.status} ${await res.text()}`);
        }

        console.log(`[SHOPIFY] Set product ${productId} status to ${status}.`);
        return true;
    } catch (error) {
        console.error("[Shopify Error] Failed to update program listing status:", error);

        await reportShopifyFailure(
            "setProgramListingArchived",
            error,
            {
                shopifyProductId: program.shopifyProductId,
                shopifyVariantId: program.shopifyVariantId ?? null,
                archived,
            },
            `Failed to set the Shopify product status to <strong>${status}</strong> while ${archived ? "archiving" : "un-archiving"} a program's listing.`,
        );

        return false;
    }
}
