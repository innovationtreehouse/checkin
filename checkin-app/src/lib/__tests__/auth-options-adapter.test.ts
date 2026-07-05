/**
 * @jest-environment node
 */
/**
 * Regression guard for the NextAuth PrismaAdapter ↔ Person-model mapping in
 * auth-options.ts (the `user: prisma.person` shim).
 *
 * Why this exists: the Participant→Person rename (#708) missed that mapping —
 * it was hidden behind an `as` cast, so tsc stayed green — and every Google
 * sign-in on the dev instance crashed in the OAuth callback with
 * `Cannot read properties of undefined (reading 'findUnique')` in
 * getUserByEmail. No test tier caught it, because the adapter's user methods
 * run ONLY inside the real Google OAuth callback: persona-mint/credentials
 * sign-in (what flow tests use via loginAs) never touches the adapter, and
 * the global prisma mock in jest.setup.js is a permissive proxy that resolves
 * ANY model name, so even importing auth-options can't surface a stale name.
 *
 * This suite therefore (a) mocks prisma with ONLY the real model names and
 * (b) actually CALLS the adapter methods — PrismaAdapter's closures are lazy,
 * so a stale mapping only explodes on invocation, exactly as in production.
 */

import prisma from '@/lib/prisma';
import { addHouseholdLead } from '@/lib/household/leads';

// Same env scaffolding as auth-options-jwt.test.ts: real ORG_DOMAIN, settable
// predicates so auth-options constructs cleanly at import time.
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

// ONLY the real model names — a shim pointing at a renamed/stale model finds
// `undefined` here and throws, exactly like production. Do NOT add a fallback
// proxy; the whole point is that unknown model names must fail.
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
        household: { create: jest.fn() },
        $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prismaMockTx)),
    },
}));

jest.mock('@/lib/household/leads', () => ({ addHouseholdLead: jest.fn() }));

// jest.setup.js globally mocks @/lib/auth-options to `{}`; unmock to get the real adapter.
jest.unmock('@/lib/auth-options');

import { authOptions } from '@/lib/auth-options';

const prismaMockTx = {
    household: { create: jest.fn() },
    person: { create: jest.fn() },
};

const mockPersonFindUnique = (prisma as unknown as { person: { findUnique: jest.Mock } })
    .person.findUnique;

// Adapter methods are typed optional on Adapter; the shim always provides these.
const adapter = authOptions.adapter as unknown as {
    getUserByEmail: (email: string) => Promise<unknown>;
    getUser: (id: string) => Promise<unknown>;
    createUser: (user: Record<string, unknown>) => Promise<{ id: string; email: string }>;
};

beforeEach(() => {
    jest.clearAllMocks();
});

describe('PrismaAdapter user-model shim (auth-options.ts)', () => {
    test('adapter is wired with the user→person mapping', () => {
        // If the shim referenced a stale model, `user` would be undefined and
        // PrismaAdapter would still construct — the breakage is lazy. Assert the
        // methods exist up front so a gutted adapter fails loudly here too.
        expect(typeof adapter.getUserByEmail).toBe('function');
        expect(typeof adapter.getUser).toBe('function');
        expect(typeof adapter.createUser).toBe('function');
    });

    test('getUserByEmail (the OAuth-callback path that broke in #708) queries prisma.person', async () => {
        mockPersonFindUnique.mockResolvedValue(null);
        // With a stale shim this throws `Cannot read properties of undefined
        // (reading 'findUnique')` — the exact production failure.
        await expect(adapter.getUserByEmail('who@example.com')).resolves.toBeNull();
        expect(mockPersonFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: expect.objectContaining({ email: 'who@example.com' }) }),
        );
    });

    test('getUser resolves numeric ids against prisma.person', async () => {
        mockPersonFindUnique.mockResolvedValue({ id: 42, email: 'p@example.com' });
        const user = await adapter.getUser('42');
        expect(mockPersonFindUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 42 } }),
        );
        expect(user).toEqual(expect.objectContaining({ id: '42', email: 'p@example.com' }));
    });

    test('createUser creates a Person inside a household transaction', async () => {
        prismaMockTx.household.create.mockResolvedValue({ id: 9 });
        prismaMockTx.person.create.mockResolvedValue({ id: 7, email: 'new@example.com' });
        const created = await adapter.createUser({ email: 'new@example.com', name: 'New Person' });
        expect(prismaMockTx.person.create).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ householdId: 9 }) }),
        );
        expect(addHouseholdLead).toHaveBeenCalled();
        expect(created).toEqual(expect.objectContaining({ id: '7', email: 'new@example.com' }));
    });
});
