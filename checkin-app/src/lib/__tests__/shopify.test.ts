import { createShopifyProgramVariants, resetTokenCache } from '../shopify';
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
