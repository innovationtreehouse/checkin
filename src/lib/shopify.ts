import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

export async function createShopifyProgramVariants(name: string, memberPrice: number | null, nonMemberPrice: number | null) {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const accessToken = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;

  if (!storeDomain || !accessToken) {
    console.warn("Shopify integration is disabled: Missing credentials in .env");
    return null;
  }

  try {
    // Determine product title
    const productTitle = `Program Enrollment: ${name}`;

    // 1. Create Product
    const productRes = await fetch(`https://${storeDomain}/admin/api/2024-01/products.json`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': accessToken,
      },
      body: JSON.stringify({
        product: {
          title: productTitle,
          status: 'active',
          options: [{ name: "Membership Type" }]
        }
      })
    });

    if (!productRes.ok) {
        const errorData = await productRes.text();
        console.error(`[Shopify API Error] ${productRes.status} ${productRes.statusText}`, errorData);
        throw new Error(`Shopify API responded with status: ${productRes.status}`);
    }

    const productData = await productRes.json();
    const productId = productData.product.id;

    // 2. Create Variants
    const variants = [];

    if (memberPrice !== null && memberPrice > 0) {
        variants.push({
            product_id: productId,
            option1: "Member",
            price: (memberPrice).toFixed(2), // Ensure string format for Shopify
            requires_shipping: false,
        });
    }

    if (nonMemberPrice !== null && nonMemberPrice > 0) {
        variants.push({
            product_id: productId,
            option1: "Non-Member",
            price: (nonMemberPrice).toFixed(2),
            requires_shipping: false,
        });
    }

    let memberVariantId: string | null = null;
    let nonMemberVariantId: string | null = null;

    if (variants.length > 0) {
        for (const variant of variants) {
            const variantRes = await fetch(`https://${storeDomain}/admin/api/2024-01/products/${productId}/variants.json`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Shopify-Access-Token': accessToken,
                },
                body: JSON.stringify({ variant })
            });

            if (variantRes.ok) {
                const variantData = await variantRes.json();
                if (variant.option1 === "Member") {
                    memberVariantId = variantData.variant.id.toString();
                } else {
                    nonMemberVariantId = variantData.variant.id.toString();
                }
            } else {
                console.error("Failed to create Shopify variant:", await variantRes.text());
            }
        }
    }

    return {
        shopifyProductId: productId.toString(),
        shopifyMemberVariantId: memberVariantId,
        shopifyNonMemberVariantId: nonMemberVariantId
    };

  } catch (error) {
    console.error("[Shopify Error] Failed to create product/variants:", error);

    try {
        const admins = await prisma.participant.findMany({
            where: {
                OR: [{ sysadmin: true }, { boardMember: true }],
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
                    `<p>An error occurred in the Shopify integration while creating variants for program: <strong>${name}</strong>.</p><p>Error details:</p><pre>${error instanceof Error ? error.message : String(error)}</pre>`
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
