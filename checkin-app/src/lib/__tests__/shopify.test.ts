import { createShopifyProgramVariants, resetTokenCache } from '../shopify';
import { sendEmail } from '../email';
import prisma from '../prisma';

jest.mock('../email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true)
}));

jest.mock('../prisma', () => ({
    __esModule: true,
    default: {
        participant: {
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

    it('should return null if credentials are missing', async () => {
        delete process.env.SHOPIFY_STORE_DOMAIN;
        const result = await createShopifyProgramVariants('Test Program', 10, 20);
        expect(result).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
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
            shopifyMemberVariantId: '67890',
            shopifyNonMemberVariantId: '11111'
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

        (prisma.participant.findMany as jest.Mock).mockResolvedValueOnce(mockAdmins);

        const result = await createShopifyProgramVariants('Test Error Program', 10, 20);

        expect(result).toBeNull();

        expect(prisma.participant.findMany).toHaveBeenCalledWith({
            where: {
                OR: [{ sysadmin: true }, { boardMember: true }],
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

        (prisma.participant.findMany as jest.Mock).mockResolvedValueOnce(mockAdmins);

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
});
