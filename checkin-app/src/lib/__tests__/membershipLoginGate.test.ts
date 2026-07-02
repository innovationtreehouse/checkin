import { orgMembershipStatusBlocksLogin } from '@/lib/orgMembership';

describe('orgMembershipStatusBlocksLogin', () => {
    it('blocks login only for DENIED households', () => {
        expect(orgMembershipStatusBlocksLogin('DENIED')).toBe(true);
    });

    it('does not block login for ACTIVE, REVOKED, NONE, or missing membership', () => {
        expect(orgMembershipStatusBlocksLogin('ACTIVE')).toBe(false);
        expect(orgMembershipStatusBlocksLogin('REVOKED')).toBe(false);
        expect(orgMembershipStatusBlocksLogin('NONE')).toBe(false);
        expect(orgMembershipStatusBlocksLogin(null)).toBe(false);
        expect(orgMembershipStatusBlocksLogin(undefined)).toBe(false);
    });
});
