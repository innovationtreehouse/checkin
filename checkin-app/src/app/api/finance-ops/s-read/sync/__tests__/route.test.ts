/**
 * @jest-environment node
 */
/**
 * Unit tests for POST /api/finance-ops/s-read/sync — the deny paths (401 anon /
 * 403 plain member, through the REAL withAuth with a mocked session), the
 * unwired-env 503, and the invocation contract.
 *
 * The load-bearing test here is "ignores a caller-supplied mode": the trigger
 * Lambda also accepts {"mode":"backfill"}, which submits a Shopify Bulk Operation.
 * The route must never let the body reach the payload.
 */
import { POST } from '../route';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));

const sendMock = jest.fn();
jest.mock('@aws-sdk/client-lambda', () => ({
    LambdaClient: jest.fn().mockImplementation(() => ({ send: sendMock })),
    InvokeCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

function req(body?: unknown) {
    return new Request('http://localhost/api/finance-ops/s-read/sync', {
        method: 'POST',
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
}

/** The single InvokeCommand input the route built. */
function invokedWith() {
    return sendMock.mock.calls[0][0].input;
}

const prevFunction = process.env.S_READ_TRIGGER_FUNCTION;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.S_READ_TRIGGER_FUNCTION = 's-read-dev-trigger';
    sendMock.mockResolvedValue({ StatusCode: 200 });
});

afterAll(() => {
    process.env.S_READ_TRIGGER_FUNCTION = prevFunction;
});

describe('POST /api/finance-ops/s-read/sync', () => {
    it('401 when unauthenticated, without invoking', async () => {
        mockSession.mockResolvedValue(null);
        const res = await POST(req());
        expect(res.status).toBe(401);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('403 for a signed-in member without board or sysadmin role, without invoking', async () => {
        mockSession.mockResolvedValue({ user: { id: 5, isSysadmin: false, isBoardMember: false } });
        const res = await POST(req());
        expect(res.status).toBe(403);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('invokes the configured trigger with a hardcoded incremental mode for a board member', async () => {
        mockSession.mockResolvedValue({ user: { id: 5, isBoardMember: true } });
        const res = await POST(req());

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true });
        expect(sendMock).toHaveBeenCalledTimes(1);
        expect(invokedWith().FunctionName).toBe('s-read-dev-trigger');
        expect(JSON.parse(invokedWith().Payload)).toEqual({ mode: 'incremental' });
    });

    it('ignores a caller-supplied mode — the body can never reach the payload', async () => {
        mockSession.mockResolvedValue({ user: { id: 5, isBoardMember: true } });
        const res = await POST(req({ mode: 'backfill' }));

        expect(res.status).toBe(200);
        expect(JSON.parse(invokedWith().Payload)).toEqual({ mode: 'incremental' });
    });

    it('503 when no trigger function is configured, without invoking', async () => {
        delete process.env.S_READ_TRIGGER_FUNCTION;
        mockSession.mockResolvedValue({ user: { id: 5, isBoardMember: true } });

        const res = await POST(req());
        expect(res.status).toBe(503);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it('500 when the invoke fails', async () => {
        mockSession.mockResolvedValue({ user: { id: 5, isBoardMember: true } });
        sendMock.mockRejectedValue(new Error('AccessDeniedException'));

        const res = await POST(req());
        expect(res.status).toBe(500);
    });
});
