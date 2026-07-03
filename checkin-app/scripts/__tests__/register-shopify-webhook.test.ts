import { decideWebhookAction, type ShopifyWebhookSubscription } from "../register-shopify-webhook";

describe("decideWebhookAction", () => {
    const desired = "https://ops-dev.innovationtreehouse.org/api/webhooks/shopify";

    it("creates when the subscription list is empty", () => {
        expect(decideWebhookAction([], desired)).toEqual({ action: "create" });
    });

    it("creates when no subscription has the orders/paid topic", () => {
        const existing: ShopifyWebhookSubscription[] = [
            { id: 1, topic: "orders/create", address: desired },
        ];
        expect(decideWebhookAction(existing, desired)).toEqual({ action: "create" });
    });

    it("updates when orders/paid exists with a different address", () => {
        const existing: ShopifyWebhookSubscription[] = [
            { id: 42, topic: "orders/paid", address: "https://old-host/api/webhooks/shopify" },
        ];
        expect(decideWebhookAction(existing, desired)).toEqual({ action: "update", id: 42, staleDuplicates: [] });
    });

    it("noops when orders/paid already points at the desired address", () => {
        const existing: ShopifyWebhookSubscription[] = [
            { id: 42, topic: "orders/paid", address: desired },
        ];
        expect(decideWebhookAction(existing, desired)).toEqual({ action: "noop", id: 42, staleDuplicates: [] });
    });

    it("targets the subscription already at the desired address and surfaces others as stale duplicates", () => {
        const existing: ShopifyWebhookSubscription[] = [
            { id: 7, topic: "orders/paid", address: "https://dead-tunnel/api/webhooks/shopify" },
            { id: 42, topic: "orders/paid", address: desired },
        ];
        expect(decideWebhookAction(existing, desired)).toEqual({ action: "noop", id: 42, staleDuplicates: [7] });
    });
});
