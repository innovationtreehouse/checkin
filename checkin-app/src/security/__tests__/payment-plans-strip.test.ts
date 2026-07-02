/**
 * @jest-environment node
 */
/**
 * Strip-assertion for GET /api/finance-ops/payment-plans. The handler returns
 * ProgramParticipant rows with the participant nested. Pulls the live view
 * tokens from the registry so this tracks any future policy edit.
 *
 *   - board/sysadmin view (everyones:*)  → nested participant.email (pii) survives.
 *   - any non-admin view (member+public) → email stripped, name kept. This is the
 *     migration's whole point: a role later added to this route is auto-stripped.
 */
import { stripValue } from '@/security/stripper';
import { scopesHeld, type CallerContext } from '@/security/access-resolvers';
import { getRoute, type Role, type Token } from '@/security/core';
import '@/security/registry';

function ctx(opts: Partial<CallerContext> = {}): CallerContext {
    return {
        selfId: undefined,
        householdId: undefined,
        isKeyholder: false,
        isKiosk: false,
        programsLed: new Set(),
        programsCoreVolIn: new Set(),
        participantIdsInScopePrograms: new Set(),
        householdIdsInScopePrograms: new Set(),
        eventIdsInScopePrograms: new Set(),
        activeVisitorIds: new Set(),
        ...opts,
    };
}

function tokensFor(endpoint: string, role: Role): readonly Token[] {
    const spec = getRoute(endpoint);
    if (!spec) throw new Error(`no registry entry for ${endpoint}`);
    const entry = spec.orderedView.find(([r]) => r === role);
    if (!entry) throw new Error(`no orderedView entry for ${role} on ${endpoint}`);
    return entry[1];
}

const ENDPOINT = 'GET /api/finance-ops/payment-plans';

// A pending row with the participant (pii) + program nested, as the handler ships it.
const row = {
    programId: 1,
    participantId: 2,
    status: 'PENDING',
    isPaymentPlanRequested: true,
    person: { id: 2, name: 'Member Name', email: 'member@x.test', dateOfBirth: '2000-01-01' },
    program: { id: 1, name: 'Woodshop' },
};

describe('payment-plans field-stripping', () => {
    it('board sees the nested participant email + dateOfBirth (pii)', () => {
        const tokens = tokensFor(ENDPOINT, 'isBoardMember');
        const out = stripValue('ProgramParticipant', row, tokens, ctx()) as Record<string, unknown>;
        const p = out.person as Record<string, unknown>;
        expect(p.email).toBe('member@x.test');
        expect(p.dateOfBirth).toBe('2000-01-01');
        expect(p.name).toBe('Member Name');
    });

    it('a non-admin view (member+public) strips email/dob but keeps name', () => {
        // Not in the registry today — proves the declared policy auto-strips any
        // role later granted a member/public-only view of this route.
        const tokens: readonly Token[] = ['member', 'public'];
        const out = stripValue('ProgramParticipant', row, tokens, ctx()) as Record<string, unknown>;
        const p = out.person as Record<string, unknown>;
        expect(p.email).toBeUndefined();
        expect(p.dateOfBirth).toBeUndefined();
        expect(p.name).toBe('Member Name');
    });

    it('Participant.email is pii, so everyones:pii is required to see it', () => {
        // Guards the assumption the test rests on.
        const board = tokensFor(ENDPOINT, 'isBoardMember');
        expect(board).toContain('everyones:pii');
        const scopes = scopesHeld('Participant', row.person, ctx());
        expect(scopes.has('everyones')).toBe(true);
    });
});
