/**
 * @jest-environment node
 */
/**
 * Privilege-revocation tests for the jwt() callback in auth-options.ts.
 *
 * The jwt() callback is the PRIMARY enforcement path for revocation: on every token refresh
 * (no `user` present, `token.id` set) it re-looks-up the participant and re-stamps authority
 * claims, so a deleted account or a board "Deny Membership" loses access within the refresh
 * window instead of when the JWT ages out. authClaims.test.ts covers the pure claim-stamper
 * (assignParticipantClaims) in isolation; this drives the callback WIRING around it.
 *
 * prisma is mocked (no DB). withAuroraResumeRetry passes through — it only retries on P1001,
 * which a mocked findUnique never throws. assignParticipantClaims is the REAL implementation so
 * we exercise the actual stamping the callback relies on.
 */

import prisma from '@/lib/prisma';

// Real ORG_DOMAIN/evaluateMint; settable env predicates so auth-options constructs cleanly
// (GoogleProvider reads the client env at module load).
jest.mock('@/lib/config', () => {
    const actual = jest.requireActual('@/lib/config');
    return {
        __esModule: true,
        ...actual,
        config: {
            ...actual.config,
            checkinEnv: jest.fn(() => 'dev'),
            isDevInstance: jest.fn(() => true),
            isProd: jest.fn(() => false),
            nextAuthSecret: jest.fn(() => 'test-secret'),
            googleClientId: jest.fn(() => 'gid'),
            googleClientSecret: jest.fn(() => 'gsecret'),
        },
    };
});

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { participant: { findUnique: jest.fn(), update: jest.fn() } },
}));

// jest.setup.js globally mocks @/lib/auth-options to `{}`; unmock to get the real callbacks.
jest.unmock('@/lib/auth-options');

import { authOptions } from '@/lib/auth-options';

const mockFindUnique = (prisma as unknown as { participant: { findUnique: jest.Mock } })
    .participant.findUnique;

type JwtCallback = NonNullable<NonNullable<typeof authOptions.callbacks>['jwt']>;
const jwt: JwtCallback = authOptions.callbacks!.jwt!;

// Minimal args the callback ignores on the refresh path (no google/persona provider).
function callRefresh(token: Record<string, unknown>) {
    return jwt({ token, account: null, profile: undefined } as unknown as Parameters<JwtCallback>[0]);
}

function dbParticipant(overrides: Record<string, unknown> = {}) {
    return {
        id: 7,
        email: 'p@example.com',
        sysadmin: true,
        keyholder: true,
        boardMember: true,
        backgroundCheckReviewer: true,
        householdId: 99,
        toolStatuses: [{ toolId: 1, level: 'CERTIFIED' }],
        household: { membership: { status: 'ACTIVE' } },
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe('jwt() callback — revocation enforcement on refresh', () => {
    it('deleted participant (findUnique → null, token.id set) ⇒ returns an empty token', async () => {
        mockFindUnique.mockResolvedValue(null);

        const result = await callRefresh({
            id: 7,
            sysadmin: true,
            keyholder: true,
            boardMember: true,
            backgroundCheckReviewer: true,
        });

        // Fails closed: no identity, no roles carried forward.
        expect(result).toEqual({});
        expect((result as { id?: unknown }).id).toBeUndefined();
        expect((result as { sysadmin?: unknown }).sysadmin).toBeUndefined();
    });

    it('DENIED membership ⇒ denied=true and every role flag forced false', async () => {
        mockFindUnique.mockResolvedValue(
            dbParticipant({ household: { membership: { status: 'DENIED' } } }),
        );

        const result = (await callRefresh({
            id: 7,
            sysadmin: true,
            keyholder: true,
            boardMember: true,
            backgroundCheckReviewer: true,
        })) as Record<string, unknown>;

        expect(result.denied).toBe(true);
        expect(result.sysadmin).toBe(false);
        expect(result.keyholder).toBe(false);
        expect(result.boardMember).toBe(false);
        expect(result.backgroundCheckReviewer).toBe(false);
        expect(result.toolStatuses).toEqual([]);
        // Identity preserved so the /access-denied gate can still resolve the session.
        expect(result.id).toBe(7);
    });

    it('active sysadmin ⇒ role flags re-stamped true', async () => {
        mockFindUnique.mockResolvedValue(dbParticipant());

        const result = (await callRefresh({
            id: 7,
            // Token came in with roles already stripped — refresh must restore them from the DB.
            sysadmin: false,
            keyholder: false,
        })) as Record<string, unknown>;

        expect(mockFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 7 } }),
        );
        expect(result.denied).toBe(false);
        expect(result.sysadmin).toBe(true);
        expect(result.keyholder).toBe(true);
        expect(result.boardMember).toBe(true);
        expect(result.backgroundCheckReviewer).toBe(true);
        expect(result.toolStatuses).toEqual([{ toolId: 1, level: 'CERTIFIED' }]);
    });

    it('no token.id and no user ⇒ no DB lookup, token passed through untouched', async () => {
        const result = await callRefresh({ hd: 'x', emailVerified: true });

        expect(mockFindUnique).not.toHaveBeenCalled();
        expect(result).toEqual({ hd: 'x', emailVerified: true });
    });
});

describe('jwt() callback — initial sign-in branch (user present)', () => {
    it('stamps claims from the participant resolved by user.email', async () => {
        mockFindUnique.mockResolvedValue(dbParticipant({ sysadmin: true }));

        const result = (await jwt({
            token: {},
            user: { email: 'p@example.com' },
            account: { provider: 'google' },
            profile: { email_verified: true },
        } as unknown as Parameters<JwtCallback>[0])) as Record<string, unknown>;

        // Resolved by email on sign-in (not by id).
        expect(mockFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { email: 'p@example.com' } }),
        );
        expect(result.id).toBe(7);
        expect(result.sysadmin).toBe(true);
        expect(result.denied).toBe(false);
        // Google hosted-domain claims captured for the dev gate.
        expect(result.emailVerified).toBe(true);
    });
});
