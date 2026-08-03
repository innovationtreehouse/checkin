/**
 * The whole-entity decommission certifier must accept exactly one shape —
 * entire top-level entries spliced out, subjects gone in the same PR — and
 * reject every partial edit, because partial removals can WIDEN exposure
 * (deleting one element of an `all:` match weakens the condition).
 */
import {
    BINDINGS_CONTAINERS,
    certifyDecommission,
    diffSegmentations,
    isBoundaryPath,
    segmentByContainers,
    segmentTopLevelCalls,
} from '../lib/boundary-decommission';

const BINDINGS_BASE = `/**
 * SCOPE_BINDINGS — the declarative per-row scope table.
 */
import { makeScopesHeld, type ScopeBindings } from './scopes';

export const SCOPE_BINDINGS = {
    Person: {
        their_own: { field: 'id', eqCtx: 'selfId' },
        // note with braces: earns { field: 'personId' } later
        keyholders: { flag: 'isKeyholder' },
    },
    FeePayment: {
        their_own: { field: 'personId', eqCtx: 'selfId' },
        their_program_participants: { field: 'personId', inCtx: 'participantIdsInScopePrograms' },
    },
    Visit: {
        their_own: { field: 'personId', eqCtx: 'selfId' },
        all_current_visitors: {
            all: [{ flag: 'isKeyholder' }, { field: 'departedAt', isNull: true }],
        },
    },
    RawBadgeLog: { their_own: { field: 'personId', eqCtx: 'selfId' } },
} as const satisfies ScopeBindings;

export const ROW_SCOPE_KEY: Record<string, string> = {
    EmergencyContact: 'householdId',
};

export const OPT_OUT_PENDING_ROUTE = new Set<string>([
    'Corporation', // has leads→personId; a corp-lead view is plausible
    'PersonRole',
]);

export const scopesHeld = makeScopesHeld(SCOPE_BINDINGS, ROW_SCOPE_KEY);
`;

const REGISTRY_BASE = `/**
 * THE security policy.
 */
import { defineRoute, defineOutbound } from './core';

// ─── Routes ────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/profile',
    authorize: 'self',
    envelope: 'profile',
    returns: ['Person'],
    orderedView: [
        ['authenticated', ['their_own:pii', 'member', 'public']],
    ],
});

// Payments history for the caller's own household.
defineRoute({
    endpoint: 'GET /api/fees/payments',
    authorize: 'authenticated',
    envelope: null,
    returns: ['FeePayment'],
    orderedView: [
        ['authenticated', ['their_own:personal', 'member', 'public']],
    ],
});

defineOutbound({
    surface: 'email.admin-notify',
    tiers: ['public', 'pii'],
});
`;

const SCHEMA_BASE = `model Person {
  id Int @id
}

model FeePayment {
  id Int @id
  personId Int
}
`;

const SCHEMA_DROPPED = `model Person {
  id Int @id
}
`;

// Splice one or more whole line-ranges (inclusive, 0-indexed) out of a source.
const dropLines = (src: string, ...ranges: [number, number][]) =>
    src
        .split('\n')
        .filter((_, i) => !ranges.some(([a, b]) => i >= a && i <= b))
        .join('\n');

const lineOf = (src: string, needle: string) => src.split('\n').findIndex(l => l.includes(needle));

// Whole-entry removal of FeePayment from the bindings fixture.
const bindingsWithoutFeePayment = dropLines(
    BINDINGS_BASE,
    [lineOf(BINDINGS_BASE, 'FeePayment: {'), lineOf(BINDINGS_BASE, 'FeePayment: {') + 3],
);

describe('segmentation', () => {
    it('round-trips and names every top-level entry, single-line entries included', () => {
        const r = segmentByContainers(BINDINGS_BASE, BINDINGS_CONTAINERS);
        expect(r.error).toBeUndefined();
        const entities = r.segments!.filter(s => s.type === 'entity').map(s => `${s.container}:${s.name}`);
        expect(entities).toEqual([
            'SCOPE_BINDINGS:Person',
            'SCOPE_BINDINGS:FeePayment',
            'SCOPE_BINDINGS:Visit',
            'SCOPE_BINDINGS:RawBadgeLog',
            'ROW_SCOPE_KEY:EmergencyContact',
            'OPT_OUT_PENDING_ROUTE:Corporation',
            'OPT_OUT_PENDING_ROUTE:PersonRole',
        ]);
    });

    it('keys registry calls by endpoint/surface', () => {
        const r = segmentTopLevelCalls(REGISTRY_BASE);
        expect(r.error).toBeUndefined();
        const entities = r.segments!.filter(s => s.type === 'entity').map(s => `${s.container}:${s.name}`);
        expect(entities).toEqual([
            'defineRoute:GET /api/profile',
            'defineRoute:GET /api/fees/payments',
            'defineOutbound:email.admin-notify',
        ]);
    });
});

describe('diffSegmentations', () => {
    const diffBindings = (head: string) =>
        diffSegmentations(segmentByContainers(BINDINGS_BASE, BINDINGS_CONTAINERS), head, s =>
            segmentByContainers(s, BINDINGS_CONTAINERS),
        );

    it('accepts a whole-entry removal', () => {
        expect(diffBindings(bindingsWithoutFeePayment)).toEqual({
            removed: [{ container: 'SCOPE_BINDINGS', name: 'FeePayment' }],
        });
    });

    it('accepts removals from ROW_SCOPE_KEY and OPT_OUT_PENDING_ROUTE, comments included', () => {
        const head = dropLines(
            BINDINGS_BASE,
            [lineOf(BINDINGS_BASE, 'EmergencyContact:'), lineOf(BINDINGS_BASE, 'EmergencyContact:')],
            [lineOf(BINDINGS_BASE, "'Corporation',"), lineOf(BINDINGS_BASE, "'Corporation',")],
        );
        expect(diffBindings(head).removed).toEqual([
            { container: 'ROW_SCOPE_KEY', name: 'EmergencyContact' },
            { container: 'OPT_OUT_PENDING_ROUTE', name: 'Corporation' },
        ]);
    });

    it('REJECTS deleting one element of an all: match — that widens the grant', () => {
        const i = lineOf(BINDINGS_BASE, "{ field: 'departedAt', isNull: true }");
        const head = BINDINGS_BASE.split('\n')
            .map((l, n) => (n === i ? '            all: [{ flag: \'isKeyholder\' }],' : l))
            .join('\n');
        expect(diffBindings(head)).toHaveProperty('error');
    });

    it('rejects editing a surviving entry', () => {
        const head = bindingsWithoutFeePayment.replace("field: 'id'", "field: 'householdId'");
        expect(diffBindings(head)).toHaveProperty('error');
    });

    it('rejects additions', () => {
        const head = BINDINGS_BASE.replace(
            '} as const satisfies ScopeBindings;',
            "    NewModel: { their_own: { field: 'personId', eqCtx: 'selfId' } },\n} as const satisfies ScopeBindings;",
        );
        expect(diffBindings(head)).toHaveProperty('error');
    });

    it('rejects reorders', () => {
        const person = BINDINGS_BASE.split('\n').slice(
            lineOf(BINDINGS_BASE, 'Person: {'),
            lineOf(BINDINGS_BASE, 'Person: {') + 5,
        );
        const head = dropLines(
            BINDINGS_BASE,
            [lineOf(BINDINGS_BASE, 'Person: {'), lineOf(BINDINGS_BASE, 'Person: {') + 4],
        )
            .split('\n')
            .flatMap(l => (l.includes('RawBadgeLog') ? [l, ...person] : [l]))
            .join('\n');
        expect(diffBindings(head)).toHaveProperty('error');
    });

    it('rejects a no-op diff', () => {
        expect(diffBindings(BINDINGS_BASE)).toHaveProperty('error');
    });
});

describe('certifyDecommission', () => {
    const files = (over: Record<string, string | null>) => (p: string) => {
        if (p in over) return over[p];
        if (p === 'checkin-app/src/security/scopeBindings.ts') return BINDINGS_BASE;
        if (p === 'checkin-app/src/security/registry.ts') return REGISTRY_BASE;
        if (p === 'checkin-app/prisma/schema.prisma') return SCHEMA_BASE;
        return null;
    };

    const BINDINGS = 'checkin-app/src/security/scopeBindings.ts';
    const SCHEMA = 'checkin-app/prisma/schema.prisma';
    const MIGRATION = 'checkin-app/prisma/migrations/20260803000000_drop_fee/migration.sql';

    it('certifies the FR7 shape: binding + schema drop + migration in one PR', () => {
        const r = certifyDecommission({
            changed: [
                { status: 'M', path: BINDINGS },
                { status: 'M', path: SCHEMA },
                { status: 'M', path: 'checkin-app/src/security/generated/classifications.ts' },
                { status: 'A', path: MIGRATION },
            ],
            violations: [MIGRATION],
            readBase: files({}),
            readHead: files({ [BINDINGS]: bindingsWithoutFeePayment, [SCHEMA]: SCHEMA_DROPPED }),
        });
        expect(r.reasons).toEqual([]);
        expect(r.ok).toBe(true);
        expect(r.removedModels).toEqual(['FeePayment']);
    });

    it('rejects a binding removal whose model survives in the schema', () => {
        const r = certifyDecommission({
            changed: [{ status: 'M', path: BINDINGS }, { status: 'A', path: MIGRATION }],
            violations: [MIGRATION],
            readBase: files({}),
            readHead: files({ [BINDINGS]: bindingsWithoutFeePayment }),
        });
        expect(r.ok).toBe(false);
        expect(r.reasons.join()).toContain('survives in schema.prisma');
    });

    it('rejects any engine-file change outright', () => {
        const r = certifyDecommission({
            changed: [
                { status: 'M', path: BINDINGS },
                { status: 'M', path: 'checkin-app/src/security/scopes.ts' },
            ],
            violations: [],
            readBase: files({}),
            readHead: files({ [BINDINGS]: bindingsWithoutFeePayment, [SCHEMA]: SCHEMA_DROPPED }),
        });
        expect(r.ok).toBe(false);
        expect(r.reasons.join()).toContain('scopes.ts');
    });

    it('certifies a route kill only once the verb stops being served', () => {
        const REGISTRY = 'checkin-app/src/security/registry.ts';
        const ROUTE_FILE = 'checkin-app/src/app/api/fees/payments/route.ts';
        const start = lineOf(REGISTRY_BASE, "// Payments history");
        const registryWithoutFees = dropLines(REGISTRY_BASE, [start - 1, start + 9]);

        const attempt = (routeHead: string | null, status: 'M' | 'D') =>
            certifyDecommission({
                changed: [
                    { status: 'M', path: REGISTRY },
                    { status, path: ROUTE_FILE },
                ],
                violations: [ROUTE_FILE],
                readBase: files({}),
                readHead: files({ [REGISTRY]: registryWithoutFees, [ROUTE_FILE]: routeHead }),
            });

        expect(attempt('export async function GET() {}', 'M').ok).toBe(false);
        const killed = attempt(null, 'D');
        expect(killed.reasons).toEqual([]);
        expect(killed.ok).toBe(true);
        expect(killed.removedEndpoints).toEqual(['GET /api/fees/payments']);
    });

    it('rejects outbound-surface removals', () => {
        const REGISTRY = 'checkin-app/src/security/registry.ts';
        const start = lineOf(REGISTRY_BASE, 'defineOutbound({');
        const head = dropLines(REGISTRY_BASE, [start - 1, start + 3]);
        const r = certifyDecommission({
            changed: [{ status: 'M', path: REGISTRY }],
            violations: [],
            readBase: files({}),
            readHead: files({ [REGISTRY]: head }),
        });
        expect(r.ok).toBe(false);
        expect(r.reasons.join()).toContain('outbound');
    });

    it('rejects modified app code riding along, while allowing deletions and migrations', () => {
        const r = certifyDecommission({
            changed: [
                { status: 'M', path: BINDINGS },
                { status: 'M', path: SCHEMA },
                { status: 'A', path: MIGRATION },
                { status: 'D', path: 'checkin-app/src/lib/fees.ts' },
                { status: 'M', path: 'checkin-app/src/lib/membership.ts' },
            ],
            violations: [MIGRATION, 'checkin-app/src/lib/fees.ts', 'checkin-app/src/lib/membership.ts'],
            readBase: files({}),
            readHead: files({ [BINDINGS]: bindingsWithoutFeePayment, [SCHEMA]: SCHEMA_DROPPED }),
        });
        expect(r.ok).toBe(false);
        expect(r.reasons).toHaveLength(1);
        expect(r.reasons[0]).toContain('membership.ts');
    });
});

describe('isBoundaryPath', () => {
    it('mirrors the workflow: security src yes, generated no, certifier scripts yes', () => {
        expect(isBoundaryPath('checkin-app/src/security/registry.ts')).toBe(true);
        expect(isBoundaryPath('checkin-app/src/security/generated/classifications.ts')).toBe(false);
        expect(isBoundaryPath('checkin-app/scripts/security-generator.js')).toBe(true);
        expect(isBoundaryPath('checkin-app/scripts/lib/boundary-decommission.js')).toBe(true);
        expect(isBoundaryPath('checkin-app/src/lib/fees.ts')).toBe(false);
    });
});
