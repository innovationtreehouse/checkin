/**
 * Unit tests for the admission gate (resolveAccess). Pure: no DB, no HTTP.
 * Focus on the 'self' case binding to the resource id param — a latent IDOR
 * guard, so it must fail closed on a present-but-mismatched id.
 */
import { resolveAccess, type ResolverContext } from '@/security/access-resolvers';
import type { AuthResult } from '@/types/auth';

const session = (id: number): AuthResult => ({
    type: 'session',
    user: {
        id,
        email: 'u@x.test',
        sysadmin: false,
        boardMember: false,
        keyholder: false,
        backgroundCheckReviewer: false,
    },
});

const rctx = (auth: AuthResult, params: Record<string, string> = {}): ResolverContext => ({
    auth,
    params,
    callerContext: {
        selfId: auth.type === 'session' ? auth.user.id : undefined,
        householdId: undefined,
        isKeyholder: false,
        isKiosk: false,
        programsLed: new Set(),
        programsCoreVolIn: new Set(),
        participantIdsInScopePrograms: new Set(),
        householdIdsInScopePrograms: new Set(),
        activeVisitorIds: new Set(),
    },
});

describe("resolveAccess 'self'", () => {
    test('no id param + session → allowed (handler scopes itself, e.g. GET /api/profile)', async () => {
        expect((await resolveAccess('self', rctx(session(42)))).allowed).toBe(true);
    });

    test('matching id param → allowed', async () => {
        expect((await resolveAccess('self', rctx(session(42), { id: '42' }))).allowed).toBe(true);
    });

    test('mismatched id param → denied (IDOR fail-closed)', async () => {
        expect((await resolveAccess('self', rctx(session(42), { id: '43' }))).allowed).toBe(false);
    });

    test('non-numeric id param → denied', async () => {
        expect((await resolveAccess('self', rctx(session(42), { id: 'abc' }))).allowed).toBe(false);
    });

    test('no session → denied', async () => {
        expect((await resolveAccess('self', rctx({ type: 'unauthenticated' }, { id: '42' }))).allowed).toBe(false);
    });
});
