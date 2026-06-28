/**
 * @jest-environment node
 */
/**
 * The `member` tier is a FLAT token like `public` (no row gate): a member-tier
 * field is visible iff the view holds the `member` token. Authenticated-member
 * views hold both `member` and `public`; an anonymous view holds only `public`,
 * so member-tier fields stay hidden from anon. Guards the core predicate that
 * gates ToolStatus.level (member tier) across every route.
 */
import { fieldVisible, parseToken, type Token } from '../core';

const NO_SCOPES = new Set<never>();

describe('member tier', () => {
    it('parseToken recognises the flat member token', () => {
        expect(parseToken('member')).toBe('member');
    });

    it('a member-role view (member + public) sees a member-tier field', () => {
        const memberView: Token[] = ['member', 'public'];
        expect(fieldVisible('member', memberView, NO_SCOPES)).toBe(true);
    });

    it('an anonymous (public-only) view does NOT see a member-tier field', () => {
        const anonView: Token[] = ['public'];
        expect(fieldVisible('member', anonView, NO_SCOPES)).toBe(false);
    });

    it('member is flat — no row scope makes a member field visible without the token', () => {
        const scopedView: Token[] = ['everyones:internal', 'public'];
        expect(fieldVisible('member', scopedView, new Set(['everyones']))).toBe(false);
    });

    it('the member token does not leak scoped tiers', () => {
        const memberView: Token[] = ['member', 'public'];
        expect(fieldVisible('internal', memberView, new Set(['everyones']))).toBe(false);
        expect(fieldVisible('pii', memberView, new Set(['everyones']))).toBe(false);
    });
});
