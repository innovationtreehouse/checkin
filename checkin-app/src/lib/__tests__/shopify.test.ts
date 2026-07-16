import { createShopifyProgramVariants, createShopifySingleVariantProgram, adjustProgramInventory, mintMemberDiscountCode, setProgramListingArchived, resetTokenCache } from '../shopify';
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

jest.mock('../logger', () => ({
    logIntegrationError: jest.fn().mockResolvedValue(undefined),
}));
import { logIntegrationError } from '../logger';

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

        // Product creation — variants come back inline on the created product
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ product: { id: 12345, variants: [
                { id: 67890, option1: 'Member' },
                { id: 11111, option1: 'Non-Member' },
            ] } })
        });

        const result = await createShopifyProgramVariants('Test Program', 10, 20);

        expect(result).toEqual({
            shopifyProductId: '12345',
            shopifyOrgMemberVariantId: '67890',
            shopifyNonOrgMemberVariantId: '11111'
        });

        // ONE product call with inline variants — a bare product create would
        // mint a physical $0 "Default Title" variant and 422 the follow-up
        // variant POSTs (the original bug).
        expect(fetchMock).toHaveBeenCalledTimes(2); // token + product (variants inline)
        const productBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
        expect(productBody.product.options).toEqual([{ name: 'Membership Type' }]);
        expect(productBody.product.variants).toEqual([
            expect.objectContaining({ option1: 'Member', price: '0.10', requires_shipping: false }),
            expect.objectContaining({ option1: 'Non-Member', price: '0.20', requires_shipping: false }),
        ]);
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
        // Single priced tier (member only) keeps the fetch sequence short:
        // token, product (variant inline), locations, [inventory_levels/set].
        // Connect-first: token, product, locations, inventory_levels/connect, inventory_levels/set.
        it('connects the item to the location, THEN sets inventory, when maxParticipants is configured', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 500, variants: [{ id: 600, option1: 'Member', inventory_item_id: 700 }] } }) }); // product + inline variant
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 900 }] }) }); // locations
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // inventory_levels/connect
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // inventory_levels/set

            const result = await createShopifyProgramVariants('Inventory Program', 10, null, 5);

            expect(result).toEqual({
                shopifyProductId: '500',
                shopifyOrgMemberVariantId: '600',
                shopifyNonOrgMemberVariantId: null,
            });
            expect(fetchMock).toHaveBeenCalledTimes(5);
            expect(String(fetchMock.mock.calls[2][0])).toContain('/locations.json');

            // connect BEFORE set — a new tracked variant isn't stocked anywhere yet, and
            // set alone 422s (that's the sold-out bug).
            const connectCall = fetchMock.mock.calls[3];
            expect(String(connectCall[0])).toContain('/inventory_levels/connect.json');
            expect(JSON.parse((connectCall[1] as RequestInit).body as string)).toEqual({
                location_id: 900,
                inventory_item_id: 700,
            });

            const invCall = fetchMock.mock.calls[4];
            expect(String(invCall[0])).toContain('/inventory_levels/set.json');
            expect(JSON.parse((invCall[1] as RequestInit).body as string)).toEqual({
                location_id: 900,
                inventory_item_id: 700,
                available: 5,
            });
            expect(logIntegrationError).not.toHaveBeenCalled();
        });

        it('picks an ACTIVE location, not locations[0], to connect+set against', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 510, variants: [{ id: 610, option1: 'Member', inventory_item_id: 710 }] } }) });
            // A deactivated location sorts first; the active one is second.
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 111, active: false }, { id: 222, active: true }] }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // connect
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // set

            const result = await createShopifyProgramVariants('Active Location Program', 10, null, 4);

            expect(result?.shopifyOrgMemberVariantId).toBe('610');
            // the ACTIVE location (222), not the first (deactivated, 111) one — for both calls
            expect(JSON.parse((fetchMock.mock.calls[3][1] as RequestInit).body as string)).toEqual({
                location_id: 222,
                inventory_item_id: 710,
            });
            expect(JSON.parse((fetchMock.mock.calls[4][1] as RequestInit).body as string)).toEqual({
                location_id: 222,
                inventory_item_id: 710,
                available: 4,
            });
            expect(logIntegrationError).not.toHaveBeenCalled();
        });

        it('treats a 422 from connect as "level already exists" and still sets (e.g. a re-sync)', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 520, variants: [{ id: 620, option1: 'Member', inventory_item_id: 720 }] } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 990, active: true }] }) });
            fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => 'inventory level already exists' }); // connect → 422
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // set still runs

            const result = await createShopifyProgramVariants('Already Connected Program', 10, null, 6);

            expect(result?.shopifyOrgMemberVariantId).toBe('620');
            expect(fetchMock).toHaveBeenCalledTimes(5); // token, product, locations, connect(422), set
            expect(String(fetchMock.mock.calls[4][0])).toContain('/inventory_levels/set.json');
            expect(JSON.parse((fetchMock.mock.calls[4][1] as RequestInit).body as string)).toEqual({ location_id: 990, inventory_item_id: 720, available: 6 });
            expect(logIntegrationError).not.toHaveBeenCalled(); // a 422 here is benign
        });

        it('surfaces and skips set when connect hard-fails (not a 422)', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 530, variants: [{ id: 630, option1: 'Member', inventory_item_id: 730 }] } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 991, active: true }] }) });
            fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'connect boom' }); // connect → 500

            jest.spyOn(console, 'error').mockImplementation(() => {});
            const result = await createShopifyProgramVariants('Connect Fail Program', 10, null, 2);

            expect(result?.shopifyOrgMemberVariantId).toBe('630');
            expect(fetchMock).toHaveBeenCalledTimes(4); // no set — connect failed hard
            expect(logIntegrationError).toHaveBeenCalledWith(
                'shopify',
                expect.objectContaining({ message: expect.stringContaining('inventory_levels/connect returned 500') }),
                expect.objectContaining({ operation: 'setInitialShopifyInventory' }),
            );
        });

        it('surfaces to IntegrationErrorLog when inventory set ultimately fails — a sold-out product is visible, not silent', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 501, variants: [{ id: 601, option1: 'Member', inventory_item_id: 701 }] } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 901, active: true }] }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // connect ok
            fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'inventory boom' }); // set fails

            jest.spyOn(console, 'error').mockImplementation(() => {});
            const result = await createShopifyProgramVariants('Inventory Fail Program', 10, null, 3);

            // Non-fatal to the create: the variant itself was made fine (returned),
            // but the inventory failure is now logged to the Link Status tab so the
            // resulting sold-out product doesn't ship silently. Still no admin email.
            expect(result).toEqual({
                shopifyProductId: '501',
                shopifyOrgMemberVariantId: '601',
                shopifyNonOrgMemberVariantId: null,
            });
            expect(logIntegrationError).toHaveBeenCalledWith(
                'shopify',
                expect.objectContaining({ message: expect.stringContaining('inventory_levels/set returned 500') }),
                expect.objectContaining({ operation: 'setInitialShopifyInventory' }),
            );
            expect(sendEmail).not.toHaveBeenCalled();
        });

        it('surfaces (not silently skips) when the store has no locations configured', async () => {
            mockTokenResponse(fetchMock);
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 502, variants: [{ id: 602, option1: 'Member', inventory_item_id: 702 }] } }) });
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [] }) });

            const result = await createShopifyProgramVariants('No Location Program', 10, null, 2);

            expect(result?.shopifyOrgMemberVariantId).toBe('602');
            // No inventory_levels/set call (no location), but the failure is surfaced.
            expect(fetchMock).toHaveBeenCalledTimes(3);
            expect(logIntegrationError).toHaveBeenCalledWith(
                'shopify',
                expect.objectContaining({ message: expect.stringContaining('no Shopify location') }),
                expect.objectContaining({ operation: 'setInitialShopifyInventory' }),
            );
        });

        it('surfaces when the created variant has no inventory_item_id (would be sold out)', async () => {
            mockTokenResponse(fetchMock);
            // Product create response omits inventory_item_id on the tracked variant.
            fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 503, variants: [{ id: 603, option1: 'Member' }] } }) });

            const result = await createShopifyProgramVariants('No Inventory Item Program', 10, null, 2);

            expect(result?.shopifyOrgMemberVariantId).toBe('603');
            // Bails before locations/set (nothing to set stock on), but surfaces it.
            expect(fetchMock).toHaveBeenCalledTimes(2); // token, product only
            expect(logIntegrationError).toHaveBeenCalledWith(
                'shopify',
                expect.objectContaining({ message: expect.stringContaining('no inventory_item_id') }),
                expect.objectContaining({ operation: 'setInitialShopifyInventory' }),
            );
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

    // Archived listing (SHOPIFY_LISTING_ARCHIVE.md): the single choke point for
    // every capacity push no-ops when the program's listing is archived, even
    // with real creds present — no live listing to adjust.
    it('no-ops successfully when the program listing is archived (no fetch)', async () => {
        const result = await adjustProgramInventory(
            { shopifyOrgMemberVariantId: '67890', shopifyNonOrgMemberVariantId: '11111', shopifyArchivedAt: new Date() },
            5,
        );

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

    it('creates the product with its ONE variant inline (non-physical, base price) and sets inventory', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 700, variants: [{ id: 800, inventory_item_id: 900 }] } }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ locations: [{ id: 950 }] }) });
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // inventory_levels/connect
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // inventory_levels/set

        const result = await createShopifySingleVariantProgram('Single Pool Program', 3500, 10);

        expect(result).toEqual({ shopifyProductId: '700', shopifyVariantId: '800' });
        expect(fetchMock).toHaveBeenCalledTimes(5); // token + product (variant inline) + locations + connect + set
        expect(String(fetchMock.mock.calls[3][0])).toContain('/inventory_levels/connect.json');
        expect(String(fetchMock.mock.calls[4][0])).toContain('/inventory_levels/set.json');

        // The variant MUST ride inside the product create: a bare create mints a
        // physical $0 "Default Title" variant that 422s the follow-up variant
        // POST (no variant stored) and makes checkout ask for shipping.
        const productCall = fetchMock.mock.calls[1];
        expect(String(productCall[0])).toContain('/products.json');
        expect(JSON.parse((productCall[1] as RequestInit).body as string)).toMatchObject({
            product: { variants: [{ price: '35.00', requires_shipping: false, inventory_management: 'shopify', inventory_policy: 'deny' }] },
        });
    });

    it('returns null and emails admins when product creation fails', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: false, status: 422, statusText: 'Unprocessable Entity', text: async () => '{"errors":"bad variant"}' });
        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce([{ email: 'admin@test.com' }]);

        const result = await createShopifySingleVariantProgram('Broken Program', 3500);

        expect(result).toBeNull();
        expect(sendEmail).toHaveBeenCalledWith(
            'admin@test.com',
            'Shopify Integration Error',
            expect.stringContaining('Shopify API responded with status: 422'),
        );
    });

    it('returns null and emails admins when the created product comes back without a variant', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 702, variants: [] } }) });
        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce([{ email: 'admin@test.com' }]);

        const result = await createShopifySingleVariantProgram('Variantless Program', 3500);

        expect(result).toBeNull();
        expect(sendEmail).toHaveBeenCalledWith(
            'admin@test.com',
            'Shopify Integration Error',
            expect.stringContaining('missing the created variant'),
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

    it('creates the discount via GraphQL discountCodeBasicCreate and returns the code', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: { discountCodeBasicCreate: { codeDiscountNode: { id: 'gid://shopify/DiscountCodeNode/1' }, userErrors: [] } } }),
        });

        const result = await mintMemberDiscountCode(42, '999888', 1000);

        expect(result).toMatch(/^PRG42-/);
        expect(fetchMock).toHaveBeenCalledTimes(2); // token + one GraphQL mutation
        const gqlCall = fetchMock.mock.calls[1];
        expect(String(gqlCall[0])).toContain('/graphql.json');
        const body = JSON.parse((gqlCall[1] as RequestInit).body as string);
        expect(body.query).toContain('discountCodeBasicCreate');
        expect(body.variables.discount).toMatchObject({
            usageLimit: 1,
            appliesOncePerCustomer: true,
            customerSelection: { all: true },
            customerGets: {
                // appliesOnEachItem carries the 'each' per-unit semantics (multi-child carts).
                value: { discountAmount: { amount: '10.00', appliesOnEachItem: true } },
                items: { products: { productVariantsToAdd: ['gid://shopify/ProductVariant/999888'] } },
            },
        });
        expect(body.variables.discount.title).toBe(result);
        expect(body.variables.discount.code).toBe(result);
    });

    it('returns null and does NOT email admins when minting fails (quiet fallback, never blocks checkout)', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => '{"errors":"bad request"}' });

        const result = await mintMemberDiscountCode(42, '999888', 1000);

        expect(result).toBeNull();
        expect(sendEmail).not.toHaveBeenCalled();
    });

    it('returns null (quiet fallback) when the mutation reports userErrors', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ data: { discountCodeBasicCreate: { codeDiscountNode: null, userErrors: [{ field: ['basicCodeDiscount'], message: 'nope' }] } } }),
        });

        const result = await mintMemberDiscountCode(42, '999888', 1000);

        expect(result).toBeNull();
        expect(sendEmail).not.toHaveBeenCalled();
        expect(logIntegrationError).toHaveBeenCalled();
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

describe('setProgramListingArchived', () => {
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

    it('PUTs the stored product id to status=archived on archive', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ product: { id: 123, status: 'archived' } }) });

        const result = await setProgramListingArchived(
            { shopifyProductId: '123', shopifyVariantId: '456', shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null },
            true,
        );

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2); // token + product PUT
        const putCall = fetchMock.mock.calls[1];
        expect(String(putCall[0])).toContain('/products/123.json');
        expect((putCall[1] as RequestInit).method).toBe('PUT');
        expect(JSON.parse((putCall[1] as RequestInit).body as string)).toEqual({ product: { id: 123, status: 'archived' } });
    });

    it('PUTs status=active on un-archive', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

        const result = await setProgramListingArchived(
            { shopifyProductId: '789', shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null },
            false,
        );

        expect(result).toBe(true);
        expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toEqual({ product: { id: 789, status: 'active' } });
    });

    it('derives the product id from a variant when only variant ids are stored', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ variant: { product_id: 555 } }) }); // GET variant
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // PUT product

        const result = await setProgramListingArchived(
            { shopifyProductId: null, shopifyOrgMemberVariantId: '456', shopifyNonOrgMemberVariantId: null },
            true,
        );

        expect(result).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(3); // token + variant get + product PUT
        expect(String(fetchMock.mock.calls[1][0])).toContain('/variants/456.json');
        expect(String(fetchMock.mock.calls[2][0])).toContain('/products/555.json');
    });

    it('no-ops success for a program with no listing (no fetch)', async () => {
        const result = await setProgramListingArchived(
            { shopifyProductId: null, shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null },
            true,
        );
        expect(result).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('no-ops success when the Shopify mock is active (local)', async () => {
        process.env.CHECKIN_ENV = 'local';
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await setProgramListingArchived(
            { shopifyProductId: '123', shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null },
            true,
        );
        expect(result).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false without calling fetch when credentials are missing (real env)', async () => {
        delete process.env.SHOPIFY_STORE_DOMAIN;
        delete process.env.SHOPIFY_CLIENT_ID;
        delete process.env.SHOPIFY_CLIENT_SECRET;

        const result = await setProgramListingArchived(
            { shopifyProductId: '123', shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null },
            true,
        );
        expect(result).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns false and emails admins (non-fatal) when the status update fails', async () => {
        mockTokenResponse(fetchMock);
        fetchMock.mockResolvedValueOnce({ ok: false, status: 422, text: async () => '{"errors":"bad status"}' });
        (prisma.person.findMany as jest.Mock).mockResolvedValueOnce([{ email: 'admin@test.com' }]);

        const result = await setProgramListingArchived(
            { shopifyProductId: '123', shopifyOrgMemberVariantId: null, shopifyNonOrgMemberVariantId: null },
            true,
        );

        expect(result).toBe(false);
        expect(sendEmail).toHaveBeenCalledWith(
            'admin@test.com',
            'Shopify Integration Error',
            expect.stringContaining('Failed to set the Shopify product status'),
        );
    });
});
