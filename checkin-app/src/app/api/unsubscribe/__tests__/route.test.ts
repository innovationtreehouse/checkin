/**
 * @jest-environment node
 */
/**
 * Unit tests for /api/unsubscribe — GET must never flip the flag (mail scanners and
 * link-preview bots prefetch GET links), only POST does. Prisma is mocked (this route's
 * own logic — token verify + which prisma call each verb makes — is what's under test;
 * the real DB write is covered end-to-end by the integration suites elsewhere).
 */
import { GET, POST } from '../route';
import { sign } from '@/lib/outreach/unsubscribeToken';

const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: {
            findUnique: (...args: unknown[]) => mockFindUnique(...args),
            update: (...args: unknown[]) => mockUpdate(...args),
        },
    },
}));

const prevSecret = process.env.NEXTAUTH_SECRET;
beforeAll(() => { process.env.NEXTAUTH_SECRET = 'unit-test-nextauth-secret'; });
afterAll(() => {
    if (prevSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = prevSecret;
});

beforeEach(() => jest.clearAllMocks());

function url(personId: number, sig: string) {
    return `http://localhost:4000/api/unsubscribe?p=${personId}&sig=${encodeURIComponent(sig)}`;
}

describe('GET /api/unsubscribe', () => {
    it('renders a confirm page and does NOT flip the flag', async () => {
        mockFindUnique.mockResolvedValue({ email: 'member@example.com' });
        const sig = sign(42);
        const res = await GET(new Request(url(42, sig)));
        expect(res.status).toBe(200);
        const html = await res.text();
        expect(html).toContain('Stop membership invitation emails');
        expect(html).toContain('member@example.com');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('bad signature -> neutral "expired or invalid" page, no flip, no lookup', async () => {
        const res = await GET(new Request(url(42, 'not-the-real-signature')));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('expired or invalid');
        expect(mockFindUnique).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('missing params -> neutral page', async () => {
        const res = await GET(new Request('http://localhost:4000/api/unsubscribe'));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain('expired or invalid');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('unknown person id (valid signature, no such row) -> neutral page, no info leak', async () => {
        mockFindUnique.mockResolvedValue(null);
        const res = await GET(new Request(url(999, sign(999))));
        expect(await res.text()).toContain('expired or invalid');
        expect(mockUpdate).not.toHaveBeenCalled();
    });
});

describe('POST /api/unsubscribe', () => {
    it('flips emailSuppressed with a valid token', async () => {
        mockFindUnique.mockResolvedValue({ id: 42 });
        mockUpdate.mockResolvedValue({ id: 42, emailSuppressed: true });
        const sig = sign(42);
        const res = await POST(new Request(url(42, sig), { method: 'POST' }));
        expect(res.status).toBe(200);
        expect(await res.text()).toContain("You're unsubscribed");
        expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 42 }, data: { emailSuppressed: true } });
    });

    it('bad signature -> neutral page, does not flip', async () => {
        const res = await POST(new Request(url(42, 'garbage'), { method: 'POST' }));
        expect(await res.text()).toContain('expired or invalid');
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('is idempotent — a second POST on an already-suppressed person still succeeds', async () => {
        mockFindUnique.mockResolvedValue({ id: 42 });
        mockUpdate.mockResolvedValue({ id: 42, emailSuppressed: true });
        const sig = sign(42);
        const first = await POST(new Request(url(42, sig), { method: 'POST' }));
        const second = await POST(new Request(url(42, sig), { method: 'POST' }));
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(mockUpdate).toHaveBeenCalledTimes(2);
    });
});
