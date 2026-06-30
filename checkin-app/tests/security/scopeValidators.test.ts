/**
 * Unit tests for the CI security validators (scopes.ts). These are authored
 * but NOT wired as build gates in this chip (see §7.6); these tests prove the
 * validators detect what they are meant to, so wiring them later (Step 3) is a
 * one-liner with known-good behavior.
 */
import {
    validateBindings,
    validateRouteGrants,
    isScopable,
    type ScopeBindings,
    type RouteGrantSpec,
} from '@/security/scopes';
import { SCOPE_BINDINGS, OPT_OUT_PENDING_ROUTE } from '@/security/scopeBindings';
import { classifications } from '@/security/generated/classifications';

const CLS = classifications as unknown as Record<string, Record<string, string>>;

describe('validateBindings — field-existence (typo catcher)', () => {
    it('flags a binding field absent from the model', () => {
        const bad: ScopeBindings = { Participant: { their_own: { field: 'householdID', eqCtx: 'householdId' } } };
        expect(validateBindings(bad, CLS, new Set())).toContain('Participant.householdID — no such field');
    });

    it('flags an unknown model', () => {
        const bad: ScopeBindings = { Nope: { their_own: { field: 'id', eqCtx: 'selfId' } } };
        expect(validateBindings(bad, CLS, new Set())).toContain("binding for unknown model 'Nope'");
    });

    it('descends into `all` combinators', () => {
        const bad: ScopeBindings = {
            Visit: { all_current_visitors: { all: [{ flag: 'isKeyholder' }, { field: 'gone', isNull: true }] } },
        };
        expect(validateBindings(bad, CLS, new Set())).toContain('Visit.gone — no such field');
    });
});

describe('validateBindings — coverage (forgotten-model catcher)', () => {
    it('flags a sensitive, scopable, unbound, un-queued model', () => {
        // VolunteerDesignation is sensitive (email pii) + scopable via its
        // createdById FK; with an empty queue it must error. (MembershipProcess
        // was the old exemplar but is now un-scopable by the direct-FK heuristic
        // once bare `id` left SCOPABLE_FIELDS — it has only membershipId/
        // certifiedById, neither a recognised actor FK.)
        const errs = validateBindings(SCOPE_BINDINGS, CLS, new Set());
        expect(errs.some(e => e.startsWith('VolunteerDesignation is sensitive and scopable'))).toBe(true);
    });

    it('does not flag it when queued in OPT_OUT_PENDING_ROUTE', () => {
        const errs = validateBindings(SCOPE_BINDINGS, CLS, OPT_OUT_PENDING_ROUTE);
        expect(errs.some(e => e.startsWith('VolunteerDesignation is sensitive'))).toBe(false);
    });

    it('isScopable: structurally un-scopable model (no actor FK) is exempt', () => {
        // VerificationToken: identifier/token/expires — no id, no FK.
        expect(isScopable('VerificationToken', CLS)).toBe(false);
    });
});

describe('validateBindings — Fee/RSVP dead-field cleanup', () => {
    it('no longer flags Fee.participantId or RSVP.programId (dead refs removed)', () => {
        // The literal-port branches read columns the models lack (Fee has no
        // participantId, RSVP has no programId), never fired at runtime, and are
        // now removed (equivalence-preserving — S1 stays green).
        const errs = validateBindings(SCOPE_BINDINGS, CLS, OPT_OUT_PENDING_ROUTE);
        expect(errs).not.toContain('Fee.participantId — no such field');
        expect(errs).not.toContain('RSVP.programId — no such field');
    });
});

describe('validateRouteGrants — seam check', () => {
    const bindings: ScopeBindings = { Participant: { their_own: { field: 'id', eqCtx: 'selfId' } } };

    it('flags a granted scope that no returned model binds', () => {
        const routes: RouteGrantSpec[] = [
            { endpoint: '/api/x', orderedView: [['authenticated', ['their_households:pii']]], returns: ['Participant'] },
        ];
        const errs = validateRouteGrants(routes, bindings);
        expect(errs.some(e => e.includes("grants 'their_households:*'"))).toBe(true);
    });

    it('passes when the grant resolves and ignores everyones', () => {
        const routes: RouteGrantSpec[] = [
            { endpoint: '/api/y', orderedView: [['authenticated', ['their_own:pii', 'everyones:internal', 'public']]], returns: ['Participant'] },
        ];
        expect(validateRouteGrants(routes, bindings)).toEqual([]);
    });
});
