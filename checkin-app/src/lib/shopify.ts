// Shopify API integration using Client Credentials Grant (post-Jan 2026)
// Tokens expire after 24 hours and are cached in-memory.

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

export async function createShopifyProgramVariants(name: string, orgMemberPriceCents: number | null, nonOrgMemberPriceCents: number | null, maxParticipants: number | null = null) {
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
                    try {
                        // Get the store's primary location
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
                                        inventory_item_id: variantData.variant.inventory_item_id,
                                        available: maxParticipants,
                                    })
                                }, "Shopify set inventory");
                                if (invRes.ok) {
                                    console.log(`[SHOPIFY] Set inventory for variant ${variant.option1} to ${maxParticipants} at location ${locationId}`);
                                } else {
                                    console.error(`[SHOPIFY] Failed to set inventory: ${invRes.status}`, await invRes.text());
                                }
                            }
                        }
                    } catch (invErr) {
                        console.error("Failed to set Shopify inventory level:", invErr);
                    }
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

    // Persist for System Status > Link Status (was email-only before).
    await logIntegrationError("shopify", error, {
        operation: "createShopifyProgramVariants",
        program: name,
        orphanedProductId: productId ?? null,
    });

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
                    `<p>An error occurred in the Shopify integration while creating variants for program: <strong>${escapeHtml(name)}</strong>.</p><p>Error details:</p><pre>${escapeHtml(error instanceof Error ? error.message : String(error))}</pre>`
                )
            );

        if (emailPromises.length > 0) {
            await Promise.all(emailPromises);
        }
    } catch (dbError) {
        console.error("Failed to send Shopify error notifications:", dbError);
    }

    // We log it but do not crash the app. Admin will need to create variants manually.
    return null;
  }
}
