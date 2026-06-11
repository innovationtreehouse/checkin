import { evaluateMint } from '../impersonation';
import { ORG_DOMAIN } from '../config';

const orgCaller = {
    email: 'daniel@innovationtreehouse.org',
    hd: ORG_DOMAIN,
    emailVerified: true,
    impersonatedBy: null,
};

describe('evaluateMint', () => {
    describe('prod', () => {
        it('never allows minting, regardless of mode or caller', () => {
            expect(evaluateMint({ checkinEnv: 'prod', mode: 'impersonate', caller: orgCaller }))
                .toEqual({ allowed: false });
            expect(evaluateMint({ checkinEnv: 'prod', mode: 'return', caller: { ...orgCaller, impersonatedBy: 'x@y.org' } }))
                .toEqual({ allowed: false });
        });
    });

    describe('dev — impersonate', () => {
        it('allows a verified org member and credits their email', () => {
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'impersonate', caller: orgCaller })).toEqual({
                allowed: true,
                targetEmail: null,
                impersonatedBy: 'daniel@innovationtreehouse.org',
                carryGateClaims: true,
            });
        });

        it('refuses an unverified / non-org caller', () => {
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'impersonate', caller: { email: 'x@gmail.com', hd: null, emailVerified: true } }))
                .toEqual({ allowed: false });
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'impersonate', caller: { email: 'x@innovationtreehouse.org', hd: ORG_DOMAIN, emailVerified: false } }))
                .toEqual({ allowed: false });
        });

        it('refuses an anonymous caller (dev requires Google first)', () => {
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'impersonate', caller: null }))
                .toEqual({ allowed: false });
        });

        it('preserves the real human across nested impersonation', () => {
            // Already impersonating jane (a minted dev session carries hd=org), now becomes bob.
            const nested = { email: 'jane@example.com', hd: ORG_DOMAIN, emailVerified: true, impersonatedBy: 'daniel@innovationtreehouse.org' };
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'impersonate', caller: nested })).toMatchObject({
                allowed: true,
                impersonatedBy: 'daniel@innovationtreehouse.org',
            });
        });
    });

    describe('dev — return', () => {
        it('returns to the real identity and clears impersonatedBy', () => {
            const impersonating = { ...orgCaller, email: 'jane@example.com', impersonatedBy: 'daniel@innovationtreehouse.org' };
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'return', caller: impersonating })).toEqual({
                allowed: true,
                targetEmail: 'daniel@innovationtreehouse.org',
                impersonatedBy: null,
                carryGateClaims: true,
            });
        });

        it('refuses when not currently impersonating', () => {
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'return', caller: orgCaller }))
                .toEqual({ allowed: false });
            expect(evaluateMint({ checkinEnv: 'dev', mode: 'return', caller: null }))
                .toEqual({ allowed: false });
        });
    });

    describe('local', () => {
        it('first login (no caller) is a plain login, not an impersonation', () => {
            expect(evaluateMint({ checkinEnv: 'local', mode: 'impersonate', caller: null })).toEqual({
                allowed: true,
                targetEmail: null,
                impersonatedBy: null,
                carryGateClaims: false,
            });
        });

        it('impersonating from an existing local session credits the current identity, no gate claims', () => {
            const local = { email: 'me@example.com', hd: null, emailVerified: false, impersonatedBy: null };
            expect(evaluateMint({ checkinEnv: 'local', mode: 'impersonate', caller: local })).toEqual({
                allowed: true,
                targetEmail: null,
                impersonatedBy: 'me@example.com',
                carryGateClaims: false,
            });
        });

        it('return goes back to the real identity without gate claims', () => {
            const local = { email: 'jane@example.com', hd: null, emailVerified: false, impersonatedBy: 'me@example.com' };
            expect(evaluateMint({ checkinEnv: 'local', mode: 'return', caller: local })).toEqual({
                allowed: true,
                targetEmail: 'me@example.com',
                impersonatedBy: null,
                carryGateClaims: false,
            });
        });
    });
});
