import { createShopifyProgramVariants, createShopifySingleVariantProgram, adjustProgramInventory, mintMemberDiscountCode, resetTokenCache } from '../shopify';
import { sendEmail } from '../email';
import prisma from '../prisma';

jest.mock('../email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

jest.mock('../prisma', () => ({
    __esModule: true,
    default: {
        person: {
            findMany: jest.fn()
        }
    }
}));

// Helper: mock a successful token response
function mockTokenResponse(fetchMock: jest.Mock) {
    fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'test_token', scope: 'write_products,write_inventory,read_locations,read_orders', expires_in: 86400 })
    });
}

describe('createShopifyProgramVariants', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';
        process.env.SHOPIFY_CLIENT_ID = 'test_client_id';
        process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret';

        fetchMock = jest.fn();
        global.fetch = fetchMock;

        jest.clearAllMocks();
        resetTokenCache();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    it('should return null if credentials are missing in prod', async () => {
        // In prod, unconfigured Shopify fails closed to null (no mock stand-in).
        process.env.CHECKIN_ENV = 'prod';
        delete process.env.SHOPIFY_STORE_DOMAIN;
        const result = await createShopifyProgramVariants('Test Program', 10, 20);
        expect(result).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns synthetic variant ids for priced tiers on local (mock active)', async () => {
        // CHECKIN_ENV=local → shopifyMockActive: stand in for the real store so the
        // seed → checkout → orders/paid dev tool works with zero env. Gated on the
        // env, not on cred presence.
        process.env.CHECKIN_ENV = 'local';
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await createShopifyProgramVariants('Test Program', 10, 20);
        expect(result).not.toBeNull();
        expect(result?.shopifyProductId).toBeTruthy();
        expect(result?.shopifyOrgMemberVariantId).toBeTruthy();
        expect(result?.shopifyNonOrgMemberVariantId).toBeTruthy();
        expect(fetchMock).not.toHaveBeenCalled(); // no real API calls in mock mode

        // Free tier (price 0/null) gets no variant, matching the real branch.
        const freeMember = await createShopifyProgramVariants('Free Prog', null, 20);
        expect(freeMember?.shopifyOrgMemberVariantId).toBeNull();
        expect(freeMember?.shopifyNonOrgMemberVariantId).toBeTruthy();
    });

    it('should successfully create product and variants', async () => {
        // Token request
        mockTokenResponse(fetchMock);

        // Product creation
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ product: { id: 12345 } })
        });

        // Member variant
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ variant: { id: 67890 } })
        });

        // Non-member variant
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ variant: { id: 11111 } })
        });

        const result = await createShopifyProgramVariants('Test Program', 10, 20);

        expect(result).toEqual({
            shopifyProductId: '12345',
            shopifyOrgMemberVariantId: '67890',
            shopifyNonOrgMemberVariantId: '11111'
        });

        expect(fetchMock).toHaveBeenCalledTimes(4); // token + product + 2 variants
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('should send email to admins and board members when product creation fails', async () => {
        // Token request
        mockTokenResponse(fetchMock);

        // Product creation fails
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 400,
            statusText: 'Bad Request',
            text: async () => '{"errors": "Invalid data"}'
        });

        const mockAdmins = [
            { email: 'admin1@test.com' },
            { email: 'admin2@test.com' },
            { email: 'board1@test.com' }
        ];

        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce(mockAdmins);

        const result = await createShopifyProgramVariants('Test Error Program', 10, 20);

        expect(result).toBeNull();

        expect(prisma.person.findMany).toHaveBeenCalledWith({
            where: {
                OR: [{ isSysadmin: true }, { isBoardMember: true }],
                email: { not: null }
            },
            select: { email: true }
        });

        expect(sendEmail).toHaveBeenCalledTimes(3);
        expect(sendEmail).toHaveBeenCalledWith(
            'admin1@test.com',
            'Shopify Integration Error',
            expect.stringContaining('Shopify API responded with status: 400')
        );
    });

    it('should send email to admins and board members when fetch throws an error', async () => {
        // Token request succeeds
        mockTokenResponse(fetchMock);

        // Product creation throws
        fetchMock.mockRejectedValueOnce(new Error('Network error'));

        const mockAdmins = [
            { email: 'admin@test.com' }
        ];

        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce(mockAdmins);

        const result = await createShopifyProgramVariants('Test Network Error', 10, 20);

        expect(result).toBeNull();

        expect(sendEmail).toHaveBeenCalledTimes(1);
        expect(sendEmail).toHaveBeenCalledWith(
            'admin@test.com',
            'Shopify Integration Error',
            expect.stringContaining('Network error')
        );
    });

    it('should return null when token request fails', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: false,
            status: 401,
            text: async () => '{"error":"invalid_client"}'
        });

        const result = await createShopifyProgramVariants('Test Program', 10, 20);

        expect(result).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1); // only token request
    });

    describe('inventory branch (maxParticipants configured, real Shopify path)', () => {
        // Single priced tier (member only) keeps the fetch sequence to one variant:
        // token, product, variant, locations, [inventory_levels/set] — see shopify.ts:157-238.
        it('sets inventory at the store location when maxParticipants is configured', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 500 } }) }); // product
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { id: 600, inventory_item_id: 700 } }) }); // member variant
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 900 }] }) }); // locations
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // inventory_levels/set

            const result = await createShopifyProgramVariants('Inventory Program', 10, null, 5);

            expect(result).toEqual({
                shopifyProductId: '500',
                shopifyOrgMemberVariantId: '600',
                shopifyNonOrgMemberVariantId: null,
            });
            expect(fetchMock).toHaveBeenCalledTimes(5);
            expect(String(fetchMock.mock.calls[3][0])).toContain('/locations.json');
            const invCall = fetchMock.mock.calls[4];
            expect(String(invCall[0])).toContain('/inventory_levels/set.json');
            expect(JSON.parse((invCall[1] as RequestInit).body as string)).toEqual({
                location_id: 900,
                inventory_item_id: 700,
                available: 5,
            });
        });

        it('logs and does not fail the whole call when inventory_levels/set itself fails (non-fatal)', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 501 } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { id: 601, inventory_item_id: 701 } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 901 }] }) });
            fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'inventory boom' });

            const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const result = await createShopifyProgramVariants('Inventory Fail Program', 10, null, 3);

            // Non-fatal: the variant itself was created fine; only the inventory
            // step failed, and it's logged rather than surfaced as an error email.
            expect(result).toEqual({
                shopifyProductId: '501',
                shopifyOrgMemberVariantId: '601',
                shopifyNonOrgMemberVariantId: null,
            });
            expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to set inventory: 500'), 'inventory boom');
            expect(sendEmail).not.toHaveBeenCalled();
            // afterEach's jest.restoreAllMocks() cleans up errSpy — mockRestore()
            // here would also wipe the calls we just asserted on.
        });

        it('skips inventory_levels/set when the store has no locations configured', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 502 } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { id: 602, inventory_item_id: 702 } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [] }) });

            const result = await createShopifyProgramVariants('No Location Program', 10, null, 2);

            expect(result).toEqual({
                shopifyProductId: '502',
                shopifyOrgMemberVariantId: '602',
                shopifyNonOrgMemberVariantId: null,
            });
            // No 5th call: locations returned empty, so inventory_levels/set is never reached.
            expect(fetchMock).toHaveBeenCalledTimes(4);
        });
    });

    it('times out a hung product request and emails admins (does not hang)', async () => {
        mockTokenResponse(fetchMock); // token succeeds (its own AbortSignal.timeout is untouched)...
        // ...then the product create hangs: a fetch that only settles on abort stands in for a
        // hung TCP connection. We drive the deadline by replacing AbortSignal.timeout for that
        // one call with a controller we fire ourselves; without the timeout it never resolves.
        const deadline = new AbortController();
        const timeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
        fetchMock.mockImplementationOnce((_url: string, init: RequestInit) =>
            new Promise((_resolve, reject) => {
                const signal = init.signal as AbortSignal;
                if (signal.aborted) return reject(signal.reason);
                signal.addEventListener('abort', () => reject(signal.reason));
            }),
        );
        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce([{ email: 'admin@test.com' }]);

        const p = createShopifyProgramVariants('Test Hang', 10, 20);
        deadline.abort(new DOMException('The operation timed out', 'TimeoutError'));
        const result = await p;

        expect(result).toBeNull();
        expect(sendEmail).toHaveBeenCalledWith(
            'admin@test.com',
            'Shopify Integration Error',
            expect.stringContaining('timed out after 20000ms'),
        );
        timeoutSpy.mockRestore();
    });
});

describe('adjustProgramInventory', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let fetchMock: jest.Mock;

    const program = {
        shopifyOrgMemberVariantId: '67890',
        shopifyNonOrgMemberVariantId: '11111',
    };

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';
        process.env.SHOPIFY_CLIENT_ID = 'test_client_id';
        process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret';

        fetchMock = jest.fn();
        global.fetch = fetchMock;

        jest.clearAllMocks();
        resetTokenCache();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    it('resolves inventory_item_ids for both variants and adjusts both by delta at the store location', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 555 }] }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { inventory_item_id: 111 } }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // adjust member
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { inventory_item_id: 222 } }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // adjust non-member

        const result = await adjustProgramInventory(program, 5);

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(6); // token + locations + 2 * (variant get + adjust)

        const adjustCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes('inventory_levels/adjust.json'));
        expect(adjustCalls).toHaveLength(2);
        for (const [, init] of adjustCalls) {
            const body = JSON.parse(init.body as string);
            expect(body).toEqual({ location_id: 555, inventory_item_id: expect.any(Number), available_adjustment: 5 });
        }
    });

    it('adjusts only the configured variant when the program has just one', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 555 }] }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { inventory_item_id: 111 } }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        const result = await adjustProgramInventory(
            { shopifyOrgMemberVariantId: '67890', shopifyNonOrgMemberVariantId: null },
            -3,
        );

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(4); // token + locations + variant get + adjust
    });

    it('returns false and emails admins (non-fatal) when the adjust call fails', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 555 }] }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { inventory_item_id: 111 } }) });
        fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => '{"errors":"bad adjustment"}' });

        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce([{ email: 'admin@test.com' }]);

        const result = await adjustProgramInventory(
            { shopifyOrgMemberVariantId: '67890', shopifyNonOrgMemberVariantId: null },
            5,
        );

        expect(result).toBe(false);
        expect(sendEmail).toHaveBeenCalledWith(
            'admin@test.com',
            'Shopify Integration Error',
            expect.stringContaining('Failed to adjust Shopify inventory'),
        );
    });

    it('returns false without calling fetch when credentials are missing', async () => {
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await adjustProgramInventory(program, 5);

        expect(result).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no-ops successfully when the Shopify mock is active', async () => {
        process.env.CHECKIN_ENV = 'local';
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await adjustProgramInventory(program, 5);

        expect(result).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // Single-pool model (product decision 2026-07-06): shopifyVariantId, when
    // set, IS the whole capacity — adjust ONLY that id, never the legacy pair,
    // even if stale legacy values linger on the row.
    describe('single-pool preference', () => {
        it('adjusts only shopifyVariantId when set, ignoring the legacy pair', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 555 }] }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { inventory_item_id: 999 } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

            const result = await adjustProgramInventory(
                { shopifyVariantId: 'single-pool-variant', shopifyOrgMemberVariantId: '67890', shopifyNonOrgMemberVariantId: '11111' },
                -1,
            );

            expect(result).toBe(true);
            expect(fetchMock).toHaveBeenCalledTimes(4); // token + locations + one variant get + one adjust
            expect(String(fetchMock.mock.calls[2][0])).toContain('single-pool-variant');
        });

        it('no-ops in mock mode logging only shopifyVariantId, not the legacy pair', async () => {
            process.env.CHECKIN_ENV = 'local';
            delete process.env.SHOPIFY_STORE_DOMAIN;
            delete process.env.SHOPIFY_CLIENT_ID;
            delete process.env.SHOPIFY_CLIENT_SECRET;
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

            const result = await adjustProgramInventory(
                { shopifyVariantId: 'single-pool-variant', shopifyOrgMemberVariantId: '67890', shopifyNonOrgMemberVariantId: '11111' },
                -1,
            );

            expect(result).toBe(true);
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('single-pool-variant'));
            expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('67890'));
            logSpy.mockRestore();
        });
    });
});

describe('createShopifySingleVariantProgram', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';
        process.env.SHOPIFY_CLIENT_ID = 'test_client_id';
        process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret';

        fetchMock = jest.fn();
        global.fetch = fetchMock;

        jest.clearAllMocks();
        resetTokenCache();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    it('returns null for a free program (no base price) without calling fetch', async () => {
        const result = await createShopifySingleVariantProgram('Free Prog', null);
        expect(result).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns a synthetic single variant id on local (mock active)', async () => {
        process.env.CHECKIN_ENV = 'local';
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await createShopifySingleVariantProgram('Test Program', 3500, 10);
        expect(result).not.toBeNull();
        expect(result?.shopifyProductId).toMatch(/^dev-mock-product-/);
        expect(result?.shopifyVariantId).toMatch(/^dev-mock-variant-/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('creates one product + one variant at the base price and sets inventory', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 700 } }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { id: 800, inventory_item_id: 900 } }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 950 }] }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        const result = await createShopifySingleVariantProgram('Single Pool Program', 3500, 10);

        expect(result).toEqual({ shopifyProductId: '700', shopifyVariantId: '800' });
        expect(fetchMock).toHaveBeenCalledTimes(5); // token + product + variant + locations + inventory set
        const variantCall = fetchMock.mock.calls[2];
        expect(JSON.parse((variantCall[1] as RequestInit).body as string)).toMatchObject({
            variant: { price: '35.00', inventory_management: 'shopify', inventory_policy: 'deny' },
        });
    });

    it('returns null and emails admins when variant creation fails', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 701 } }) });
        fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => '{"errors":"bad variant"}' });
        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce([{ email: 'admin@test.com' }]);

        const result = await createShopifySingleVariantProgram('Broken Program', 3500);

        expect(result).toBeNull();
        expect(sendEmail).toHaveBeenCalledWith(
            'admin@test.com',
            'Shopify Integration Error',
            expect.stringContaining('Shopify API responded with status: 422'),
        );
    });
});

describe('mintMemberDiscountCode', () => {
    let originalEnv: NodeJS.ProcessEnv;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env.SHOPIFY_STORE_DOMAIN = 'test.myshopify.com';
        process.env.SHOPIFY_CLIENT_ID = 'test_client_id';
        process.env.SHOPIFY_CLIENT_SECRET = 'test_client_secret';

        fetchMock = jest.fn();
        global.fetch = fetchMock;

        jest.clearAllMocks();
        resetTokenCache();
    });

    afterEach(() => {
        process.env = originalEnv;
        jest.restoreAllMocks();
    });

    it('returns null for a zero/negative discount without calling fetch', async () => {
        const result = await mintMemberDiscountCode(1, 'variant-1', 0);
        expect(result).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns a synthesized code on local (mock active), no network', async () => {
        process.env.CHECKIN_ENV = 'local';
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await mintMemberDiscountCode(42, '999888', 1000);
        expect(result).toMatch(/^PRG42-/);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('creates a price rule + discount code and returns the code', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ price_rule: { id: 123 } }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        const result = await mintMemberDiscountCode(42, '999888', 1000);

        expect(result).toMatch(/^PRG42-/);
        expect(fetchMock).toHaveBeenCalledTimes(3); // token + price_rules + discount_codes
        const priceRuleCall = fetchMock.mock.calls[1];
        expect(String(priceRuleCall[0])).toContain('/price_rules.json');
        const body = JSON.parse((priceRuleCall[1] as RequestInit).body as string);
        expect(body.price_rule).toMatchObject({
            value_type: 'fixed_amount',
            value: '-10.00',
            usage_limit: 1,
            once_per_customer: true,
            entitled_variant_ids: [999888],
        });
    });

    it('returns null and does NOT email admins when minting fails (quiet fallback, never blocks checkout)', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => '{"errors":"bad price rule"}' });

        const result = await mintMemberDiscountCode(42, '999888', 1000);

        expect(result).toBeNull();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('returns null without calling fetch when credentials are missing', async () => {
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await mintMemberDiscountCode(42, '999888', 1000);
        expect(result).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
