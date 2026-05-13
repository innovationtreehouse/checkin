/**
 * Unit tests for the policy stripper — the function that decides whether
 * each field in a response reaches the wire.
 *
 * Pure unit tests: no DB, no auth, no HTTP. Synthetic CallerContexts and
 * synthetic bags. Catches regressions in fieldVisible, scopesHeld, and
 * stripValue that integration tests (which exercise correctly-written
 * handlers) won't notice.
 */
import { stripValue, stripBag } from '@/security/stripper';
import { scopesHeld, type CallerContext } from '@/security/access-resolvers';
import { fieldVisible } from '@/security/core';

function ctx(opts: Partial<CallerContext> = {}): CallerContext {
    return {
        selfId: undefined,
        householdId: undefined,
        isKeyholder: false,
        isKiosk: false,
        programsLed: new Set(),
        programsCoreVolIn: new Set(),
        participantIdsInScopePrograms: new Set(),
        activeVisitorIds: new Set(),
        ...opts,
    };
}

// Silence the "unknown model" warn from the stripper in the one test that
// exercises that path.
let warnSpy: jest.SpyInstance;
beforeAll(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => {
    warnSpy.mockRestore();
});

// ─── fieldVisible (token-grammar primitive) ────────────────────────────────

describe('fieldVisible', () => {
    it('secret is never visible', () => {
        expect(fieldVisible('secret', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public'], new Set(['everyones']))).toBe(false);
    });

    it('public visible iff "public" token granted', () => {
        const scopes = new Set(['everyones'] as const);
        expect(fieldVisible('public', ['public'], scopes)).toBe(true);
        expect(fieldVisible('public', ['everyones:pii'], scopes)).toBe(false);
    });

    it('everyones:tier grants unconditionally (no caller scope needed)', () => {
        expect(fieldVisible('pii', ['everyones:pii'], new Set(['everyones']))).toBe(true);
    });

    it('scope:tier grants only when caller holds the scope', () => {
        expect(fieldVisible('pii', ['their_own:pii'], new Set(['everyones', 'their_own']))).toBe(true);
        expect(fieldVisible('pii', ['their_own:pii'], new Set(['everyones']))).toBe(false);
    });

    it('tier in token must match tier of field', () => {
        // view grants pii but field is personal → no.
        expect(fieldVisible('personal', ['their_own:pii'], new Set(['everyones', 'their_own']))).toBe(false);
    });
});

// ─── scopesHeld (per-row scope predicate) ──────────────────────────────────

describe('scopesHeld', () => {
    it('always includes everyones', () => {
        expect(scopesHeld('Tool', { id: 1 }, ctx())).toEqual(new Set(['everyones']));
    });

    it('Participant.their_own when row.id === caller.selfId', () => {
        const s = scopesHeld('Participant', { id: 5 }, ctx({ selfId: 5 }));
        expect(s.has('their_own')).toBe(true);
    });

    it('Participant.their_own NOT held when row.id !== caller.selfId', () => {
        const s = scopesHeld('Participant', { id: 7 }, ctx({ selfId: 5 }));
        expect(s.has('their_own')).toBe(false);
    });

    it('Participant.their_households when householdIds match', () => {
        const s = scopesHeld('Participant', { id: 9, householdId: 2 }, ctx({ selfId: 5, householdId: 2 }));
        expect(s.has('their_households')).toBe(true);
    });

    it('Participant.their_program_participants when row.id in scope-programs set', () => {
        const s = scopesHeld(
            'Participant',
            { id: 9 },
            ctx({ selfId: 5, participantIdsInScopePrograms: new Set([9, 10]) }),
        );
        expect(s.has('their_program_participants')).toBe(true);
    });

    it('Participant.all_current_visitors requires keyholder AND row in active set', () => {
        const ctxWithKey = ctx({ isKeyholder: true, activeVisitorIds: new Set([9]) });
        expect(scopesHeld('Participant', { id: 9 }, ctxWithKey).has('all_current_visitors')).toBe(true);
        expect(scopesHeld('Participant', { id: 99 }, ctxWithKey).has('all_current_visitors')).toBe(false);

        const ctxNoKey = ctx({ isKeyholder: false, activeVisitorIds: new Set([9]) });
        expect(scopesHeld('Participant', { id: 9 }, ctxNoKey).has('all_current_visitors')).toBe(false);
    });

    it('Visit.their_own when row.participantId === selfId', () => {
        expect(scopesHeld('Visit', { participantId: 5, departed: null }, ctx({ selfId: 5 })).has('their_own')).toBe(true);
    });

    it('Visit.all_current_visitors requires keyholder AND departed === null', () => {
        const keyCtx = ctx({ isKeyholder: true });
        expect(scopesHeld('Visit', { participantId: 7, departed: null }, keyCtx).has('all_current_visitors')).toBe(true);
        expect(scopesHeld('Visit', { participantId: 7, departed: new Date() }, keyCtx).has('all_current_visitors')).toBe(false);
        expect(scopesHeld('Visit', { participantId: 7, departed: null }, ctx()).has('all_current_visitors')).toBe(false);
    });

    it('Household.their_households when row.id === caller.householdId', () => {
        expect(scopesHeld('Household', { id: 2 }, ctx({ householdId: 2 })).has('their_households')).toBe(true);
        expect(scopesHeld('Household', { id: 99 }, ctx({ householdId: 2 })).has('their_households')).toBe(false);
    });

    it('Program.their_program_participants when caller leads or coreVols it', () => {
        const led = ctx({ programsLed: new Set([10]) });
        expect(scopesHeld('Program', { id: 10 }, led).has('their_program_participants')).toBe(true);
        const core = ctx({ programsCoreVolIn: new Set([10]) });
        expect(scopesHeld('Program', { id: 10 }, core).has('their_program_participants')).toBe(true);
        expect(scopesHeld('Program', { id: 99 }, led).has('their_program_participants')).toBe(false);
    });

    it('returns only everyones for unknown / unsupported models', () => {
        expect(scopesHeld('ToolUnknownXYZ', { id: 1 }, ctx({ selfId: 1 }))).toEqual(new Set(['everyones']));
    });
});

// ─── stripValue (the contributor-handler scenario) ─────────────────────────

describe('stripValue — Participant', () => {
    const callerCtx = ctx({ selfId: 5 });
    const tokens = ['their_own:pii', 'their_own:personal', 'public'] as const;

    it('exposes pii on self row', () => {
        const row = { id: 5, name: 'Me', email: 'me@x.com', phone: '555' };
        const out = stripValue('Participant', row, tokens, callerCtx);
        expect(out).toEqual({ id: 5, name: 'Me', email: 'me@x.com', phone: '555' });
    });

    it('strips pii on non-self row (THE buggy-handler case)', () => {
        // Simulates a contributor handler that fetched the wrong row.
        // id and name are pii, so the stripper blocks them on non-self rows
        // alongside email/phone — the original PR-#129-class leak is closed
        // at the field-tier level rather than relying on view discipline.
        const row = { id: 7, name: 'Other', email: 'leaked@x.com', phone: '555' };
        const out = stripValue('Participant', row, tokens, callerCtx) as Record<string, unknown>;
        expect(out.id).toBeUndefined();
        expect(out.name).toBeUndefined();
        expect(out.email).toBeUndefined();
        expect(out.phone).toBeUndefined();
    });

    it('public-tier field stripped without "public" token', () => {
        // boardMember is the lone public-tier field on Participant; id/name/etc.
        // are pii or stricter and pass through other tokens.
        const row = { id: 5, boardMember: true };
        const out = stripValue('Participant', row, ['their_own:pii'], callerCtx) as Record<string, unknown>;
        expect(out.boardMember).toBeUndefined();
    });

    it('everyones:pii exposes pii on every row regardless of caller', () => {
        const stranger = ctx(); // no selfId
        const row = { id: 99, name: 'X', email: 'x@x.com' };
        const out = stripValue('Participant', row, ['everyones:pii', 'public'], stranger) as Record<string, unknown>;
        expect(out.email).toBe('x@x.com');
    });

    it('honours OR semantics: a field needs only one matching scope grant', () => {
        // Caller leads program 10; row 9 is a participant of program 10.
        const leadCtx = ctx({ selfId: 5, programsLed: new Set([10]), participantIdsInScopePrograms: new Set([9]) });
        const row = { id: 9, name: 'P', email: 'p@x.com' };
        // View only grants the program-scoped pii, not their_own.
        const out = stripValue('Participant', row, ['their_program_participants:pii', 'public'], leadCtx) as Record<string, unknown>;
        expect(out.email).toBe('p@x.com');
        // Same view but a row outside the program — email stripped.
        const outsider = { id: 999, name: 'Q', email: 'q@x.com' };
        const out2 = stripValue('Participant', outsider, ['their_program_participants:pii', 'public'], leadCtx) as Record<string, unknown>;
        expect(out2.email).toBeUndefined();
    });

    it('their_households grants household members on self/household rows', () => {
        // image is personal; homeAddress is now pii so this test uses image
        // to exercise the their_households:personal grant.
        const homeCtx = ctx({ selfId: 5, householdId: 2 });
        const sibling = { id: 6, name: 'Sib', householdId: 2, image: '/sib.jpg' };
        const out = stripValue('Participant', sibling, ['their_households:personal', 'public'], homeCtx) as Record<string, unknown>;
        expect(out.image).toBe('/sib.jpg');
        const stranger = { id: 7, name: 'X', householdId: 99, image: '/x.jpg' };
        const out2 = stripValue('Participant', stranger, ['their_households:personal', 'public'], homeCtx) as Record<string, unknown>;
        expect(out2.image).toBeUndefined();
    });
});

describe('stripValue — secret tier is unreachable', () => {
    it('everyones:internal does NOT expose secret', () => {
        const row = { id: 'acc1', userId: 5, type: 'oauth', provider: 'google', providerAccountId: 'g123', refresh_token: 'rt', access_token: 'at', id_token: 'idt' };
        const tokens = ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public'] as const;
        const out = stripValue('Account', row, tokens, ctx({ selfId: 5 })) as Record<string, unknown>;
        expect(out.userId).toBe(5);
        expect(out.refresh_token).toBeUndefined();
        expect(out.access_token).toBeUndefined();
        expect(out.id_token).toBeUndefined();
    });
});

describe('stripValue — arrays', () => {
    it('applies per-row scopes independently', () => {
        const callerCtx = ctx({ selfId: 5 });
        const tokens = ['their_own:pii', 'public'] as const;
        const rows = [
            { id: 5, name: 'me', email: 'me@x.com' },
            { id: 7, name: 'them', email: 'them@x.com' },
        ];
        const out = stripValue('Participant', rows, tokens, callerCtx) as Record<string, unknown>[];
        // Self row sees its own pii (email, name); other row sees neither.
        expect(out[0].email).toBe('me@x.com');
        expect(out[0].name).toBe('me');
        expect(out[1].email).toBeUndefined();
        expect(out[1].name).toBeUndefined();
    });
});

describe('stripValue — nested relations', () => {
    it('recursively strips household relation on a Participant', () => {
        const callerCtx = ctx({ selfId: 5, householdId: 2 });
        const tokens = ['their_own:pii', 'public'] as const; // no household:personal granted
        const row = {
            id: 5,
            name: 'Me',
            email: 'me@x.com',
            household: { id: 2, name: 'Home', address: 'private street' },
        };
        const out = stripValue('Participant', row, tokens, callerCtx) as Record<string, unknown>;
        expect(out.email).toBe('me@x.com');
        const household = out.household as Record<string, unknown>;
        expect(household.id).toBe(2);
        expect(household.name).toBe('Home');
        expect(household.address).toBeUndefined(); // personal — no token grants it
    });

    it('grants household.address when their_households:personal is in the view', () => {
        const callerCtx = ctx({ selfId: 5, householdId: 2 });
        const tokens = ['their_own:pii', 'their_households:personal', 'public'] as const;
        const row = {
            id: 5,
            email: 'me@x.com',
            household: { id: 2, name: 'Home', address: 'private street' },
        };
        const out = stripValue('Participant', row, tokens, callerCtx) as Record<string, unknown>;
        const household = out.household as Record<string, unknown>;
        expect(household.address).toBe('private street');
    });
});

describe('stripValue — _count preservation', () => {
    it('preserves Prisma _count aggregate', () => {
        const row = { id: 5, name: 'Me', _count: { visits: 3 } };
        const out = stripValue('Participant', row, ['public'], ctx({ selfId: 5 })) as Record<string, unknown>;
        expect(out._count).toEqual({ visits: 3 });
    });
});

describe('stripValue — edge cases', () => {
    it('null and undefined pass through unchanged', () => {
        expect(stripValue('Participant', null, ['public'], ctx())).toBeNull();
        expect(stripValue('Participant', undefined, ['public'], ctx())).toBeUndefined();
    });

    it('empty tokens strip everything to an empty object', () => {
        const row = { id: 5, name: 'Me', email: 'me@x.com' };
        const out = stripValue('Participant', row, [], ctx({ selfId: 5 })) as Record<string, unknown>;
        expect(out).toEqual({});
    });

    it('returns null for unknown model', () => {
        const out = stripValue('NotARealModelXYZ', { foo: 'bar' }, ['public'], ctx());
        expect(out).toBeNull();
    });
});

// ─── stripBag (the top-level wrapper) ──────────────────────────────────────

describe('stripBag', () => {
    it('drops unknown-model bag entries with a warn', () => {
        // Tool fields are all public; used here to keep the test focused on
        // unknown-model dropping rather than tier semantics.
        const out = stripBag({ Tool: { id: 1, name: 'Saw' }, NotAModel: { foo: 'bar' } }, ['public'], ctx({ selfId: 5 }));
        expect(out.Tool).toEqual({ id: 1, name: 'Saw' });
        expect(out.NotAModel).toBeUndefined();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("'NotAModel'"));
    });

    it('strips each known model with the same tokens/context', () => {
        const out = stripBag(
            {
                Participant: { id: 5, name: 'Me', email: 'me@x.com' },
                Household: { id: 2, name: 'Home', address: 'street' },
            },
            ['their_own:pii', 'their_households:personal', 'public'],
            ctx({ selfId: 5, householdId: 2 }),
        );
        expect((out.Participant as Record<string, unknown>).email).toBe('me@x.com');
        expect((out.Household as Record<string, unknown>).address).toBe('street');
    });
});
