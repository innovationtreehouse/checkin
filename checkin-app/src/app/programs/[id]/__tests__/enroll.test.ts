import { aggregateEnrollOutcomes, buildShopifyCheckoutUrl, type EnrollOutcome } from '../enroll';

describe('aggregateEnrollOutcomes', () => {
    it('collects every ok participant as enrolled with no errors', () => {
        const outcomes: EnrollOutcome[] = [
            { participantId: 1, ok: true, status: 200 },
            { participantId: 2, ok: true, status: 200 },
        ];
        const r = aggregateEnrollOutcomes(outcomes);
        expect(r.enrolledIds).toEqual([1, 2]);
        expect(r.errors).toEqual([]);
        expect(r.needsOverride).toBe(false);
    });

    // 409-as-success on the override-retry pass: members that already succeeded
    // on the first pass come back 409 on the retry and must stay enrolled, not
    // surface a spurious "already enrolled" error.
    it('treats 409 (already enrolled) as enrolled, not an error', () => {
        const outcomes: EnrollOutcome[] = [
            { participantId: 1, ok: false, status: 409, error: 'Participant is already enrolled in this program.' },
            { participantId: 2, ok: true, status: 200 },
        ];
        const r = aggregateEnrollOutcomes(outcomes);
        expect(r.enrolledIds).toEqual([1, 2]);
        expect(r.errors).toEqual([]);
        expect(r.needsOverride).toBe(false);
    });

    // Partial failure: one member enrolls, one fails — the success is kept and
    // only the real failure is aggregated.
    it('aggregates per-member errors while keeping the successes', () => {
        const outcomes: EnrollOutcome[] = [
            { participantId: 1, ok: true, status: 200 },
            { participantId: 2, ok: false, status: 400, error: 'Program has reached maximum capacity.', requiresOverride: true },
            { participantId: 3, ok: false, status: 400, error: 'Participant must be at least 18 years old.', requiresOverride: true },
        ];
        const r = aggregateEnrollOutcomes(outcomes);
        expect(r.enrolledIds).toEqual([1]);
        expect(r.errors).toEqual([
            'Program has reached maximum capacity.',
            'Participant must be at least 18 years old.',
        ]);
        expect(r.needsOverride).toBe(true);
    });

    it('falls back to a default message when the route gives no error string', () => {
        const r = aggregateEnrollOutcomes([{ participantId: 1, ok: false, status: 500 }]);
        expect(r.errors).toEqual(['Failed to enroll in program.']);
        expect(r.needsOverride).toBe(false);
    });
});

describe('buildShopifyCheckoutUrl', () => {
    it('charges qty=N of the single variant with comma-joined account ids', () => {
        const url = buildShopifyCheckoutUrl('shop.example.com', 'gid123', [11, 22, 33], 7);
        expect(url).toBe(
            'https://shop.example.com/cart/gid123:3?attributes[CheckMeIn_Account_ID]=11,22,33&attributes[Program_ID]=7'
        );
    });

    it('uses qty=1 and a single account id for a lone enrollee', () => {
        const url = buildShopifyCheckoutUrl('shop.example.com', 'gid123', [11], '7');
        expect(url).toBe(
            'https://shop.example.com/cart/gid123:1?attributes[CheckMeIn_Account_ID]=11&attributes[Program_ID]=7'
        );
    });

    // Single-pool model: a member's checkout carries a server-minted discount
    // code (mintMemberDiscountCode) prepended, mirroring buildMembershipCheckoutUrl.
    it('prepends discount=<code> when a discount code is given', () => {
        const url = buildShopifyCheckoutUrl('shop.example.com', 'gid123', [11], '7', 'PRG7-ABCD');
        expect(url).toBe(
            'https://shop.example.com/cart/gid123:1?discount=PRG7-ABCD&attributes[CheckMeIn_Account_ID]=11&attributes[Program_ID]=7'
        );
    });

    it('omits the discount param entirely when the code is null/undefined', () => {
        const url = buildShopifyCheckoutUrl('shop.example.com', 'gid123', [11], '7', null);
        expect(url).toBe(
            'https://shop.example.com/cart/gid123:1?attributes[CheckMeIn_Account_ID]=11&attributes[Program_ID]=7'
        );
    });
});
