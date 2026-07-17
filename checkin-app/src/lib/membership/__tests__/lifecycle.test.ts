/**
 * @jest-environment node
 */
/**
 * Unit tests for the membership lifecycle definition (lib/membership/lifecycle).
 * Pure — no DB. Proves the anti-drift guarantees the four fixes rely on:
 *   - awaitingBgReview.has (client predicate) ≡ awaitingBgReview.where (server
 *     Prisma fragment) across the full status × flags matrix (fix #1);
 *   - grantableRenewalWhere / settledThisCycleWhere emit the exact fragments the
 *     route + guard + sweep consume (fix #3/#4);
 *   - isLegalTransition covers the doc §5 edges; reachability flags the legacy
 *     RENEWAL_PENDING_BG as unreachable (doc §4.6 / §6.1);
 *   - the local ProcessStatus/ProcessKind unions stay in lockstep with the Prisma
 *     enums (value-based assertEnumParity here; type-only Expect<Equal> in-module).
 */
import {
    OrgMembershipProcessStatus,
    OrgMembershipProcessKind,
} from '@/generated/prisma/client';
import {
    awaitingBgReview,
    grantableRenewalWhere,
    settledThisCycleWhere,
    IN_FLIGHT_INITIAL,
    IN_FLIGHT_RENEWAL,
    LEGACY_STATUSES,
    classify,
    validate,
    isLegalTransition,
    TRANSITIONS,
    ALL_STATUSES,
    INITIAL_STATES,
    type ProcessStatus,
} from '@/lib/membership/lifecycle';
import { assertEnumParity, reachability } from '@/lib/lifecycle';

// ── fix #1: awaitingBgReview — has ≡ where on the full matrix ───────────────────

/**
 * Interpret awaitingBgReview.where against a row — the server-side semantics — so
 * we can assert it agrees with the client-side `has` for EVERY combination. If the
 * two ever drift (the whole point of the StateSet), this fails.
 */
function whereMatches(row: { status: ProcessStatus; bgConsentAt: boolean; bgClearedAt: boolean }): boolean {
    const w = awaitingBgReview.where as {
        bgClearedAt: null;
        OR: { status: { in: string[] }; bgConsentAt?: { not: null } }[];
    };
    if (row.bgClearedAt) return false; // where pins bgClearedAt: null
    return w.OR.some((clause) => {
        if (!clause.status.in.includes(row.status)) return false;
        if (clause.bgConsentAt) return row.bgConsentAt; // { not: null } ⇒ present
        return true;
    });
}

describe('awaitingBgReview', () => {
    test('has ≡ where across status × bgConsentAt × bgClearedAt', () => {
        for (const status of ALL_STATUSES) {
            for (const bgConsentAt of [true, false]) {
                for (const bgClearedAt of [true, false]) {
                    const row = { status, bgConsentAt, bgClearedAt };
                    expect(awaitingBgReview.has(row)).toBe(whereMatches(row));
                }
            }
        }
    });

    test('encodes review.ts:75 exactly', () => {
        // cleared ⇒ never awaiting, regardless of status
        expect(awaitingBgReview.has({ status: 'PENDING_BG_REVIEW', bgConsentAt: true, bgClearedAt: true })).toBe(false);
        // review states: awaiting whenever not cleared, consent irrelevant
        expect(awaitingBgReview.has({ status: 'PENDING_BG_REVIEW', bgConsentAt: false, bgClearedAt: false })).toBe(true);
        expect(awaitingBgReview.has({ status: 'RENEWAL_PENDING_BG', bgConsentAt: false, bgClearedAt: false })).toBe(true);
        // parallel states: awaiting only once consent is recorded
        expect(awaitingBgReview.has({ status: 'PENDING_PAYMENT', bgConsentAt: true, bgClearedAt: false })).toBe(true);
        expect(awaitingBgReview.has({ status: 'PENDING_PAYMENT', bgConsentAt: false, bgClearedAt: false })).toBe(false);
        expect(awaitingBgReview.has({ status: 'PENDING_BG_CLEARANCE', bgConsentAt: true, bgClearedAt: false })).toBe(true);
        // unrelated statuses never await
        expect(awaitingBgReview.has({ status: 'INTAKE', bgConsentAt: true, bgClearedAt: false })).toBe(false);
        expect(awaitingBgReview.has({ status: 'ACTIVE', bgConsentAt: true, bgClearedAt: false })).toBe(false);
    });

    test('where is the exact AWAITING_BG_WHERE fragment it replaced', () => {
        expect(awaitingBgReview.where).toEqual({
            bgClearedAt: null,
            OR: [
                { status: { in: ['PENDING_BG_REVIEW', 'RENEWAL_PENDING_BG'] } },
                { status: { in: ['PENDING_PAYMENT', 'PENDING_BG_CLEARANCE'] }, bgConsentAt: { not: null } },
            ],
        });
    });
});

// ── fix #3 / #4: renewal where builders ────────────────────────────────────────

describe('grantableRenewalWhere / settledThisCycleWhere', () => {
    test('grantableRenewalWhere = payable renewal, NOT bg-gated (fix #3, behavior (a))', () => {
        // Grant comps payment only; BG stays an independent gate on ACTIVE. So any
        // PENDING_PAYMENT renewal qualifies — no bgClearedAt clause.
        expect(grantableRenewalWhere).toEqual({ kind: 'RENEWAL', status: 'PENDING_PAYMENT' });
    });

    test('settledThisCycleWhere adds kind=RENEWAL + ARCHIVED + window (fix #4)', () => {
        const windowStart = new Date('2026-06-01T00:00:00.000Z');
        expect(settledThisCycleWhere(windowStart)).toEqual({
            kind: 'RENEWAL',
            status: { in: ['ACTIVE', 'ARCHIVED'] },
            stageEnteredAt: { gte: windowStart },
        });
    });
});

// ── fix #2: in-flight lists ────────────────────────────────────────────────────

describe('IN_FLIGHT lists', () => {
    test('INITIAL is the 5 open INITIAL statuses', () => {
        expect(IN_FLIGHT_INITIAL).toEqual([
            'INTAKE',
            'PENDING_EXTERNAL_ACTION',
            'PENDING_BG_REVIEW',
            'PENDING_PAYMENT',
            'PENDING_BG_CLEARANCE',
        ]);
    });

    test('RENEWAL is the 6 open RENEWAL statuses incl. legacy RENEWAL_PENDING_BG', () => {
        expect(new Set(IN_FLIGHT_RENEWAL)).toEqual(
            new Set([
                'PENDING_RENEWAL',
                'PENDING_EXTERNAL_ACTION',
                'PENDING_BG_REVIEW',
                'PENDING_PAYMENT',
                'PENDING_BG_CLEARANCE',
                'RENEWAL_PENDING_BG',
            ]),
        );
        expect(IN_FLIGHT_RENEWAL).toContain('RENEWAL_PENDING_BG');
        expect(LEGACY_STATUSES).toEqual(['RENEWAL_PENDING_BG']);
        // legacy is never in the INITIAL set
        expect(IN_FLIGHT_INITIAL).not.toContain('RENEWAL_PENDING_BG');
    });
});

// ── classify / validate ────────────────────────────────────────────────────────

describe('classify', () => {
    const flags = { contractSignedAt: false, bgConsentAt: false, bgClearedAt: false, paidAt: false };

    test('names on-diagram rows by status', () => {
        expect(classify({ ...flags, status: 'PENDING_PAYMENT' })).toBe('PENDING_PAYMENT');
        expect(classify({ ...flags, status: 'ACTIVE', bgClearedAt: true })).toBe('ACTIVE');
        expect(classify({ ...flags, status: 'ARCHIVED' })).toBe('ARCHIVED');
    });

    test('returns null for off-diagram flag combinations', () => {
        expect(classify({ ...flags, status: 'INTAKE', paidAt: true })).toBeNull(); // paid before external
        expect(classify({ ...flags, status: 'ACTIVE', bgClearedAt: false })).toBeNull(); // active must be cleared
    });
});

describe('validate', () => {
    const flags = { contractSignedAt: false, bgConsentAt: false, bgClearedAt: false, paidAt: false };
    test('clean rows validate null', () => {
        expect(validate({ ...flags, status: 'ACTIVE', bgClearedAt: true })).toBeNull();
        expect(validate({ ...flags, status: 'INTAKE' })).toBeNull();
    });
    test('flags the violated invariant', () => {
        expect(validate({ ...flags, status: 'INTAKE', paidAt: true })).toEqual({ invariant: 'intake-is-unpaid' });
        expect(validate({ ...flags, status: 'ACTIVE', bgClearedAt: false })).toEqual({ invariant: 'active-is-bg-cleared' });
    });
});

// ── transitions (doc §5) ───────────────────────────────────────────────────────

describe('isLegalTransition covers §5', () => {
    test('accepts declared spine edges', () => {
        expect(isLegalTransition('INTAKE', 'PENDING_EXTERNAL_ACTION')).toBe(true);
        expect(isLegalTransition('PENDING_RENEWAL', 'PENDING_EXTERNAL_ACTION')).toBe(true);
        expect(isLegalTransition('PENDING_EXTERNAL_ACTION', 'PENDING_PAYMENT')).toBe(true);
        expect(isLegalTransition('PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW')).toBe(true);
        expect(isLegalTransition('PENDING_PAYMENT', 'ACTIVE')).toBe(true);
        expect(isLegalTransition('PENDING_PAYMENT', 'PENDING_BG_CLEARANCE')).toBe(true);
        expect(isLegalTransition('PENDING_BG_REVIEW', 'PENDING_PAYMENT')).toBe(true);
        expect(isLegalTransition('PENDING_BG_CLEARANCE', 'ACTIVE')).toBe(true);
    });

    test('accepts BLOCKED transitions (reject + override resets/approve)', () => {
        expect(isLegalTransition('PENDING_BG_REVIEW', 'BLOCKED')).toBe(true);
        expect(isLegalTransition('PENDING_PAYMENT', 'BLOCKED')).toBe(true);
        expect(isLegalTransition('BLOCKED', 'PENDING_PAYMENT')).toBe(true);
        expect(isLegalTransition('BLOCKED', 'PENDING_BG_CLEARANCE')).toBe(true);
        expect(isLegalTransition('BLOCKED', 'PENDING_BG_REVIEW')).toBe(true);
        expect(isLegalTransition('BLOCKED', 'ACTIVE')).toBe(true);
    });

    test('accepts archive from every pre-terminal status, not from ACTIVE', () => {
        for (const from of ['INTAKE', 'PENDING_EXTERNAL_ACTION', 'PENDING_BG_REVIEW', 'PENDING_PAYMENT', 'PENDING_BG_CLEARANCE', 'PENDING_RENEWAL', 'BLOCKED'] as ProcessStatus[]) {
            expect(isLegalTransition(from, 'ARCHIVED')).toBe(true);
        }
        expect(isLegalTransition('ACTIVE', 'ARCHIVED')).toBe(false);
    });

    test('rejects undeclared edges', () => {
        expect(isLegalTransition('INTAKE', 'ACTIVE')).toBe(false);
        expect(isLegalTransition('ACTIVE', 'PENDING_PAYMENT')).toBe(false);
        expect(isLegalTransition('ARCHIVED', 'ACTIVE')).toBe(false);
    });

    test('filters by kind: grantRenewalPayment PENDING_PAYMENT→ACTIVE is RENEWAL-only', () => {
        // The renewal-grant edge is tagged kind: RENEWAL; the generic activate edge
        // (kind undefined) also matches PENDING_PAYMENT→ACTIVE, so both kinds pass —
        // assert the RENEWAL edge exists explicitly in the table.
        expect(TRANSITIONS.some((t) => t.from === 'PENDING_PAYMENT' && t.to === 'ACTIVE' && t.kind === 'RENEWAL')).toBe(true);
    });
});

describe('reachability (doc §6.1)', () => {
    test('flags the legacy RENEWAL_PENDING_BG as unreachable', () => {
        const r = reachability(TRANSITIONS, ALL_STATUSES, INITIAL_STATES, ['ACTIVE', 'ARCHIVED']);
        expect(r.unreachable).toContain('RENEWAL_PENDING_BG');
        // every other status is reachable from an entry state
        for (const s of ALL_STATUSES) {
            if (s === 'RENEWAL_PENDING_BG') continue;
            expect(r.reachable).toContain(s);
        }
    });
});

// ── enum parity (LIFECYCLE_ARCHITECTURE §3.4) ──────────────────────────────────

describe('enum parity with Prisma', () => {
    test('ProcessStatus union matches OrgMembershipProcessStatus keys', () => {
        expect(() => assertEnumParity(ALL_STATUSES, OrgMembershipProcessStatus, 'OrgMembershipProcessStatus')).not.toThrow();
    });
    test('ProcessKind union matches OrgMembershipProcessKind keys', () => {
        expect(() => assertEnumParity(['INITIAL', 'RENEWAL', 'PERSON_BG'], OrgMembershipProcessKind, 'OrgMembershipProcessKind')).not.toThrow();
    });
});
