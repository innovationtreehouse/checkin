import { membershipStatusBlocksLogin } from '@/lib/membership';

describe('membershipStatusBlocksLogin', () => {
    it('blocks login only for DENIED households', () => {
        expect(membershipStatusBlocksLogin('DENIED')).toBe(true);
    });

    it('does not block login for ACTIVE, REVOKED, NONE, or missing membership', () => {
        expect(membershipStatusBlocksLogin('ACTIVE')).toBe(false);
        expect(membershipStatusBlocksLogin('REVOKED')).toBe(false);
        expect(membershipStatusBlocksLogin('NONE')).toBe(false);
        expect(membershipStatusBlocksLogin(null)).toBe(false);
        expect(membershipStatusBlocksLogin(undefined)).toBe(false);
    });
});
