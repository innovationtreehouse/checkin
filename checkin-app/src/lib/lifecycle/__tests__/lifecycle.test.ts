/**
 * Unit tests for lib/lifecycle primitives, driven by a tiny in-test fixture
 * machine (a fake "Order" entity). Pure — no DB, no Prisma value import.
 */
import {
    defineStateSet,
    assertNever,
    defineValidator,
    isLegalTransition,
    reachability,
    bfsStates,
    reachableStatesViolating,
    assertEnumParity,
    type Transition,
    type Invariant,
    type Equal,
    type Expect,
} from '..';

// ---- Fixture machine -------------------------------------------------------

type OrderStatus = 'DRAFT' | 'PAID' | 'ACTIVE' | 'CANCELLED' | 'ORPHAN';
type OrderStateName = 'draft' | 'awaiting_activation' | 'active' | 'cancelled';

// Stand-in for a Prisma `WhereInput` — a plain shape, no Prisma import.
type FakeWhere = {
    status?: OrderStatus | { in: readonly OrderStatus[] };
    paidAt?: null | { not: null };
    rush?: boolean; // genuine boolean column (Boolean @default(false)) → value-equality
};

// Row shape the client-safe predicate sees: presence as a boolean, not Date|null.
type OrderRow = { status: OrderStatus; paidAt: boolean; rush: boolean };

const activeSet = defineStateSet<FakeWhere>()({ statuses: ['ACTIVE'] as const });
const paidPendingSet = defineStateSet<FakeWhere>()({
    statuses: ['PAID'] as const,
    flags: { paidAt: true },
});
// A boolean-column set (like enrollment's isPaymentPlanRequested): equals, not presence.
const rushSet = defineStateSet<FakeWhere>()({
    statuses: ['PAID'] as const,
    equals: { rush: true },
});
const nonRushSet = defineStateSet<FakeWhere>()({
    statuses: ['PAID'] as const,
    equals: { rush: false },
});

function classify(row: OrderRow): OrderStateName | null {
    switch (row.status) {
        case 'DRAFT':
            return 'draft';
        case 'PAID':
            // PAID with no payment timestamp is an off-diagram combination.
            return row.paidAt ? 'awaiting_activation' : null;
        case 'ACTIVE':
            return 'active';
        case 'CANCELLED':
            return 'cancelled';
        case 'ORPHAN':
            return null;
        default:
            return assertNever(row.status);
    }
}

const invariants: Invariant<OrderRow>[] = [
    { name: 'paid-has-timestamp', holds: (r) => r.status !== 'PAID' || r.paidAt },
    { name: 'cancelled-is-unpaid', holds: (r) => r.status !== 'CANCELLED' || !r.paidAt },
];
const validate = defineValidator(invariants);

const transitions: Transition<OrderStatus>[] = [
    { from: 'DRAFT', to: 'PAID', event: 'pay', actor: 'member', guardSite: 'route' },
    { from: 'DRAFT', to: 'CANCELLED', event: 'cancel', actor: 'member', guardSite: 'route' },
    { from: 'PAID', to: 'ACTIVE', event: 'activate', actor: 'system', guardSite: 'updateMany', kind: 'INITIAL' },
    { from: 'PAID', to: 'CANCELLED', event: 'cancel', actor: 'member', guardSite: 'route' },
];
const ALL_STATES: OrderStatus[] = ['DRAFT', 'PAID', 'ACTIVE', 'CANCELLED', 'ORPHAN'];

// ---- StateSet: has/where derive from one spec -------------------------------

describe('defineStateSet', () => {
    test('has() agrees with the spec across a status × flags × equals matrix', () => {
        for (const status of ALL_STATES) {
            for (const paidAt of [true, false]) {
                for (const rush of [true, false]) {
                    const row: OrderRow = { status, paidAt, rush };
                    expect(paidPendingSet.has(row)).toBe(status === 'PAID' && paidAt);
                    expect(activeSet.has(row)).toBe(status === 'ACTIVE');
                    // equals matches the boolean VALUE, independent of presence.
                    expect(rushSet.has(row)).toBe(status === 'PAID' && rush === true);
                    expect(nonRushSet.has(row)).toBe(status === 'PAID' && rush === false);
                }
            }
        }
    });

    test('where mirrors has for the flagged set', () => {
        expect(paidPendingSet.where).toEqual({ status: { in: ['PAID'] }, paidAt: { not: null } });
    });

    test('equals emits value-equality where, not presence', () => {
        // A boolean column: where is { rush: true/false } — NOT { not: null },
        // which would match both true and false and diverge from has.
        expect(rushSet.where).toEqual({ status: { in: ['PAID'] }, rush: true });
        expect(nonRushSet.where).toEqual({ status: { in: ['PAID'] }, rush: false });
    });

    test('where for a flagless set is status-only', () => {
        expect(activeSet.where).toEqual({ status: { in: ['ACTIVE'] } });
    });

    test('a false flag requires absence in both has and where', () => {
        const unpaidDraft = defineStateSet<FakeWhere>()({
            statuses: ['DRAFT'] as const,
            flags: { paidAt: false },
        });
        expect(unpaidDraft.has({ status: 'DRAFT', paidAt: false })).toBe(true);
        expect(unpaidDraft.has({ status: 'DRAFT', paidAt: true })).toBe(false);
        expect(unpaidDraft.where).toEqual({ status: { in: ['DRAFT'] }, paidAt: null });
    });

    test('flags and equals combine in one set', () => {
        const both = defineStateSet<FakeWhere>()({
            statuses: ['PAID'] as const,
            flags: { paidAt: true },
            equals: { rush: false },
        });
        expect(both.has({ status: 'PAID', paidAt: true, rush: false })).toBe(true);
        expect(both.has({ status: 'PAID', paidAt: true, rush: true })).toBe(false);
        expect(both.has({ status: 'PAID', paidAt: false, rush: false })).toBe(false);
        expect(both.where).toEqual({ status: { in: ['PAID'] }, paidAt: { not: null }, rush: false });
    });

    test('statuses are exposed', () => {
        expect(paidPendingSet.statuses).toEqual(['PAID']);
    });
});

// ---- classify / validate ----------------------------------------------------

describe('classify (exhaustive switch)', () => {
    test('maps on-diagram rows to their state', () => {
        expect(classify({ status: 'DRAFT', paidAt: false, rush: false })).toBe('draft');
        expect(classify({ status: 'PAID', paidAt: true, rush: false })).toBe('awaiting_activation');
        expect(classify({ status: 'ACTIVE', paidAt: true, rush: false })).toBe('active');
        expect(classify({ status: 'CANCELLED', paidAt: false, rush: false })).toBe('cancelled');
    });

    test('returns null for off-diagram combinations', () => {
        expect(classify({ status: 'PAID', paidAt: false, rush: false })).toBeNull();
        expect(classify({ status: 'ORPHAN', paidAt: false, rush: false })).toBeNull();
    });
});

describe('assertNever', () => {
    test('throws when reached at runtime', () => {
        expect(() => assertNever('surprise' as never)).toThrow(/unhandled status/);
    });
});

describe('validate', () => {
    test('returns null when every invariant holds', () => {
        expect(validate({ status: 'PAID', paidAt: true, rush: false })).toBeNull();
        expect(validate({ status: 'ACTIVE', paidAt: true, rush: false })).toBeNull();
    });

    test('returns the first violated invariant, in list order', () => {
        expect(validate({ status: 'PAID', paidAt: false, rush: false })).toEqual({ invariant: 'paid-has-timestamp' });
        expect(validate({ status: 'CANCELLED', paidAt: true, rush: false })).toEqual({ invariant: 'cancelled-is-unpaid' });
    });
});

// ---- transitions ------------------------------------------------------------

describe('isLegalTransition', () => {
    test('accepts declared edges, rejects undeclared', () => {
        expect(isLegalTransition(transitions, 'DRAFT', 'PAID')).toBe(true);
        expect(isLegalTransition(transitions, 'DRAFT', 'ACTIVE')).toBe(false);
    });

    test('filters by kind when given', () => {
        expect(isLegalTransition(transitions, 'PAID', 'ACTIVE', 'INITIAL')).toBe(true);
        expect(isLegalTransition(transitions, 'PAID', 'ACTIVE', 'RENEWAL')).toBe(false);
    });
});

describe('reachability', () => {
    test('detects reachable, terminal, unreachable, and dead-end states', () => {
        const r = reachability(transitions, ALL_STATES, ['DRAFT'], ['ACTIVE', 'CANCELLED']);
        expect(new Set(r.reachable)).toEqual(new Set(['DRAFT', 'PAID', 'ACTIVE', 'CANCELLED']));
        expect(new Set(r.terminal)).toEqual(new Set(['ACTIVE', 'CANCELLED', 'ORPHAN']));
        expect(r.unreachable).toEqual(['ORPHAN']);
        expect(r.deadEnds).toEqual([]); // both reachable terminals are designated accepting
    });

    test('a reachable terminal not marked accepting is a dead-end', () => {
        const r = reachability(transitions, ALL_STATES, ['DRAFT'], ['ACTIVE']);
        expect(r.deadEnds).toEqual(['CANCELLED']);
    });
});

describe('bfsStates + reachableStatesViolating', () => {
    test('enumerates reachable states in discovery order', () => {
        expect(bfsStates(transitions, ['DRAFT'])).toEqual(['DRAFT', 'PAID', 'CANCELLED', 'ACTIVE']);
    });

    test('reports reachable states that violate an invariant', () => {
        // Invariant: "every reachable state is classifiable (not off-diagram-only)".
        const violations = reachableStatesViolating(transitions, ['DRAFT'], (s) => s !== 'CANCELLED');
        expect(violations).toEqual(['CANCELLED']);
    });

    test('empty when the invariant holds everywhere reachable', () => {
        expect(reachableStatesViolating(transitions, ['DRAFT'], (s) => s !== 'ORPHAN')).toEqual([]);
    });
});

// ---- enum parity ------------------------------------------------------------

describe('assertEnumParity', () => {
    // In a real entity this would be `import { ProgramParticipantStatus } from
    // '@/generated/prisma/client'` (allowed in a TEST, not in client code).
    const FakePrismaEnum = { DRAFT: 'DRAFT', PAID: 'PAID', ACTIVE: 'ACTIVE', CANCELLED: 'CANCELLED', ORPHAN: 'ORPHAN' };
    const LOCAL_STATUSES: OrderStatus[] = ['DRAFT', 'PAID', 'ACTIVE', 'CANCELLED', 'ORPHAN'];

    test('passes when the local union matches the enum keys', () => {
        expect(() => assertEnumParity(LOCAL_STATUSES, FakePrismaEnum, 'OrderStatus')).not.toThrow();
    });

    test('throws when the enum gained a value the local union lacks', () => {
        const grown = { ...FakePrismaEnum, REFUNDED: 'REFUNDED' };
        expect(() => assertEnumParity(LOCAL_STATUSES, grown, 'OrderStatus')).toThrow(/REFUNDED/);
    });

    test('throws when the local union has an extra value', () => {
        expect(() => assertEnumParity([...LOCAL_STATUSES, 'GHOST'], FakePrismaEnum)).toThrow(/GHOST/);
    });

    test('compile-time Equal/Expect proves union parity', () => {
        // Fails to COMPILE if OrderStatus and the enum-keys union diverge.
        type _Parity = Expect<Equal<OrderStatus, keyof typeof FakePrismaEnum>>;
        const ok: _Parity = true;
        expect(ok).toBe(true);
    });
});
