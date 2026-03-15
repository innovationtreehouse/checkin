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
        throw new Error(`Failed to create Shopify product: ${await productRes.text()}`);
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
    console.error("Shopify integration error:", error);
    return null;
  }
}
