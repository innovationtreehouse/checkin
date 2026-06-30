// Pure helpers for the multi-select household enrollment flow on
// programs/[id]/page.tsx. Extracted so the money-path logic — 409-as-success
// idempotency, per-member error aggregation, and the Shopify cart assembly —
// is unit-testable without rendering the page. The page imports both; tests in
// __tests__/enroll.test.ts exercise them directly.

export type EnrollOutcome = {
    participantId: number;
    ok: boolean;
    status: number;
    error?: string;
    requiresOverride?: boolean;
};

/**
 * Fold per-participant POST outcomes into the aggregate the UI acts on.
 *
 * 409 = already enrolled = the desired end state (covers override-retry passes
 * where a member already succeeded on the first pass), so it counts as enrolled
 * — NOT an error. Any other non-ok status contributes its error message and, if
 * the route flagged requiresOverride, raises the override prompt.
 */
export function aggregateEnrollOutcomes(outcomes: EnrollOutcome[]): {
    enrolledIds: number[];
    errors: string[];
    needsOverride: boolean;
} {
    const enrolledIds: number[] = [];
    const errors: string[] = [];
    let needsOverride = false;

    for (const o of outcomes) {
        if (o.ok || o.status === 409) {
            enrolledIds.push(o.participantId);
            continue;
        }
        if (o.requiresOverride) needsOverride = true;
        errors.push(o.error || "Failed to enroll in program.");
    }

    return { enrolledIds, errors, needsOverride };
}

/**
 * Build the Shopify cart permalink for an enrolled household.
 *
 * Membership is household-level → every selected member shares ONE variant
 * tier, so we charge qty=N of that single variant and pass all account ids
 * comma-joined. The orders/paid webhook splits CheckMeIn_Account_ID on ',' and
 * activates each (webhooks/shopify/route.ts). Constraint: holds only while one
 * household = one membership tier = one variant.
 */
export function buildShopifyCheckoutUrl(
    storeDomain: string | undefined,
    variantId: string,
    enrolledIds: number[],
    programId: string | number,
): string {
    const accountIds = enrolledIds.join(',');
    return `https://${storeDomain}/cart/${variantId}:${enrolledIds.length}?attributes[CheckMeIn_Account_ID]=${accountIds}&attributes[Program_ID]=${programId}`;
}
