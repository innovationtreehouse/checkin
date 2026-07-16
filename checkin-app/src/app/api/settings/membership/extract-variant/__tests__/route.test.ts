/**
 * @jest-environment node
 */
/**
 * POST /api/settings/membership/extract-variant — the whole flow, with fetch
 * mocked: the SSRF pinning (https / exact store host / /products/<handle>
 * path, all rejected BEFORE any fetch), URL normalization (query/hash/trailing
 * slash stripped, `.js` appended), the 429 retry, response-shape failures, and
 * the variant-selection semantics (one → { variantId }, several → 409 listing
 * "id — title — price").
 */
import { POST } from '../route';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const STORE = 'test-store.myshopify.com';
const GOOD_URL = `https://${STORE}/products/annual-membership`;
const JS_URL = `https://${STORE}/products/annual-membership.js`;

function asBoard() {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 1, isSysadmin: false, isBoardMember: true } });
}
function req(body?: unknown) {
    return new Request('http://localhost:4000/api/settings/membership/extract-variant', {
        method: 'POST',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
}
function jsonResponse(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}
const variant = (id: number, title: string, price: number) => ({ id, title, price });

describe('POST /api/settings/membership/extract-variant', () => {
    let fetchMock: jest.Mock;
    const prevDomain = process.env.SHOPIFY_STORE_DOMAIN;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.SHOPIFY_STORE_DOMAIN = STORE;
        fetchMock = jest.fn();
        global.fetch = fetchMock;
        asBoard();
    });

    afterAll(() => {
        if (prevDomain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
        else process.env.SHOPIFY_STORE_DOMAIN = prevDomain;
    });

    it('401 when unauthenticated, and never fetches', async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(401);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('403 for a plain member, and never fetches', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 2, isSysadmin: false, isBoardMember: false } });
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('400 when productUrl is missing or blank', async () => {
        expect((await POST(req({}))).status).toBe(400);
        expect((await POST(req({ productUrl: '   ' }))).status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('extracts the id of a single-variant product, normalizing query/hash/trailing slash', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: 8819108249771, variants: [variant(45678901234, 'Default Title', 15000)] }));
        const res = await POST(req({ productUrl: `${GOOD_URL}/?utm_source=admin#reviews` }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ variantId: '45678901234' });
        // The fetch goes to the normalized product path + .js, refusing redirects.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(JS_URL);
        expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ redirect: 'error' }));
        expect(fetchMock.mock.calls[0][1].headers['User-Agent']).toMatch(/Mozilla/);
    });

    it('409 lists id — title — price for a multi-variant product', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, {
            variants: [variant(111, 'Member', 15000), variant(222, 'Non-Member', 25000)],
        }));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(409);
        const { error } = await res.json();
        expect(error).toContain('2 variants');
        expect(error).toContain('111 — Member — $150.00');
        expect(error).toContain('222 — Non-Member — $250.00');
    });

    // ── SSRF pinning: each rejection happens BEFORE any fetch ──────────────

    const rejectedBeforeFetch: Array<[string, string]> = [
        ['not a URL at all', 'annual-membership'],
        ['http, not https', `http://${STORE}/products/annual-membership`],
        ['wrong host', 'https://evil.example.com/products/annual-membership'],
        ['store domain as a suffix of another host', `https://evil-${STORE}/products/annual-membership`],
        ['explicit non-default port', `https://${STORE}:8443/products/annual-membership`],
        ['non-product path', `https://${STORE}/cart/12345:1`],
        ['nested path under products', `https://${STORE}/products/annual-membership/extra`],
        ['path traversal in the handle', `https://${STORE}/products/..%2Fadmin`],
    ];
    it.each(rejectedBeforeFetch)('400 without fetching: %s', async (_label, url) => {
        const res = await POST(req({ productUrl: url }));
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('400 without fetching when SHOPIFY_STORE_DOMAIN is not configured', async () => {
        delete process.env.SHOPIFY_STORE_DOMAIN;
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(400);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    // ── Upstream failures ───────────────────────────────────────────────────

    it('retries a 429 with backoff and succeeds on the second attempt', async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse(429, {}))
            .mockResolvedValueOnce(jsonResponse(200, { variants: [variant(333, 'Default Title', 15000)] }));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ variantId: '333' });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    }, 15000);

    it('429 with a "throttled, try again in a minute" message once retries are exhausted', async () => {
        fetchMock.mockResolvedValue(jsonResponse(429, {}));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(429);
        expect((await res.json()).error).toMatch(/throttled.*try again in a minute/);
        expect(fetchMock).toHaveBeenCalledTimes(3);
    }, 15000);

    it('404 with a clear message when Shopify has no product at the URL', async () => {
        fetchMock.mockResolvedValue(jsonResponse(404, {}));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(404);
        expect((await res.json()).error).toMatch(/no product at that URL/);
    });

    it('502 when the response is not JSON', async () => {
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('not json'); } } as unknown as Response);
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/not product JSON/);
    });

    it('502 when the JSON has no variant list', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { id: 8819108249771 }));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/no variant list/);
    });

    it('400 when the product has zero variants', async () => {
        fetchMock.mockResolvedValue(jsonResponse(200, { variants: [] }));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/no variants/);
    });

    it('502 when fetch itself rejects (network failure or refused redirect)', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(502);
        expect((await res.json()).error).toMatch(/failed or was redirected/);
    });

    it('504 when the request times out', async () => {
        fetchMock.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
        const res = await POST(req({ productUrl: GOOD_URL }));
        expect(res.status).toBe(504);
        expect((await res.json()).error).toMatch(/did not answer/);
    });
});
