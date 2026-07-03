import * as dotenv from "dotenv";
import { getAccessToken, shopifyFetch } from "../src/lib/shopify";
import { config } from "../src/lib/config";

/**
 * Idempotently upserts the `orders/paid` webhook subscription against the
 * Shopify Admin API, pointed at a caller-supplied callback URL.
 *
 *   npx tsx scripts/register-shopify-webhook.ts --url <https://host/api/webhooks/shopify> [--commit]
 *
 * Defaults to a DRY RUN (prints the create/update/noop decision, writes nothing).
 * Pass --commit to apply it. Reuses shopify.ts's token exchange and fetch wrapper —
 * no Prisma needed here, there's no DB write.
 */

dotenv.config();

const EXPECTED_PATH = "/api/webhooks/shopify";
const API_VERSION = "2026-01";

function arg(flag: string): string | undefined {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
}
const hasFlag = (flag: string) => process.argv.includes(flag);

export interface ShopifyWebhookSubscription {
    id: number | string;
    topic: string;
    address: string;
}

export type WebhookAction =
    | { action: "create" }
    | { action: "update"; id: number | string }
    | { action: "noop"; id: number | string };

/** Pure decision: does the orders/paid subscription need creating, updating, or nothing? */
export function decideWebhookAction(existing: ShopifyWebhookSubscription[], desiredAddress: string): WebhookAction {
    const match = existing.find((w) => w.topic === "orders/paid");
    if (!match) return { action: "create" };
    if (match.address === desiredAddress) return { action: "noop", id: match.id };
    return { action: "update", id: match.id };
}

async function main() {
    const url = arg("--url");
    const commit = hasFlag("--commit");

    if (!url) {
        throw new Error("--url <https://host/api/webhooks/shopify> is required.");
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`--url is not a valid URL: ${url}`);
    }
    if (parsed.protocol !== "https:") {
        throw new Error(`--url must be https — got "${parsed.protocol}//..." (${url})`);
    }
    if (!parsed.pathname.endsWith(EXPECTED_PATH)) {
        console.warn(`Warning: --url path is "${parsed.pathname}", expected it to end with "${EXPECTED_PATH}". Continuing anyway.`);
    }

    const accessToken = await getAccessToken();
    if (!accessToken) {
        console.error("Shopify not configured (missing SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, or SHOPIFY_CLIENT_SECRET) — nothing to register.");
        process.exit(1);
    }

    // getAccessToken() only succeeds once storeDomain is confirmed non-null.
    const storeDomain = config.shopifyStoreDomain()!;

    const listRes = await shopifyFetch(`https://${storeDomain}/admin/api/${API_VERSION}/webhooks.json`, {
        headers: { "X-Shopify-Access-Token": accessToken },
    }, "Shopify list webhooks");

    if (!listRes.ok) {
        console.error(`Shopify API error listing webhooks: ${listRes.status} ${await listRes.text()}`);
        process.exit(1);
    }

    const listData = await listRes.json();
    const webhooks: ShopifyWebhookSubscription[] = listData.webhooks ?? [];
    const decision = decideWebhookAction(webhooks, url);

    if (decision.action === "noop") {
        console.log(`No change needed: orders/paid webhook ${decision.id} already points at ${url}`);
        return;
    }
    if (decision.action === "create") {
        console.log(`Will CREATE an orders/paid webhook subscription pointing at ${url}`);
    } else {
        console.log(`Will UPDATE orders/paid webhook ${decision.id} address to ${url}`);
    }

    if (!commit) {
        console.log("\nDRY RUN — no changes written. Re-run with --commit to apply.");
        return;
    }

    const body = JSON.stringify({ webhook: { topic: "orders/paid", address: url, format: "json" } });
    const mutateRes = decision.action === "create"
        ? await shopifyFetch(`https://${storeDomain}/admin/api/${API_VERSION}/webhooks.json`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
            body,
        }, "Shopify create webhook")
        : await shopifyFetch(`https://${storeDomain}/admin/api/${API_VERSION}/webhooks/${decision.id}.json`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
            body,
        }, "Shopify update webhook");

    if (!mutateRes.ok) {
        console.error(`Shopify API error ${decision.action === "create" ? "creating" : "updating"} webhook: ${mutateRes.status} ${await mutateRes.text()}`);
        process.exit(1);
    }

    const result = await mutateRes.json();
    console.log(`✅ ${decision.action === "create" ? "Created" : "Updated"} webhook: id=${result.webhook.id} address=${result.webhook.address}`);
}

// Guarded so importing decideWebhookAction (e.g. from the unit test) doesn't
// also run the CLI's main().
if (require.main === module) {
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
}
