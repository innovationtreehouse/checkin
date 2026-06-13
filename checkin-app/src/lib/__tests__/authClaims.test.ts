import type { JWT } from 'next-auth/jwt';
import { assignParticipantClaims, type ClaimSourceParticipant } from '@/lib/authClaims';

function participant(overrides: Partial<ClaimSourceParticipant> = {}): ClaimSourceParticipant {
    return {
        id: 7,
        sysadmin: true,
        keyholder: true,
        boardMember: true,
        shopSteward: true,
        backgroundCheckReviewer: true,
        householdId: 99,
        toolStatuses: [{ toolId: 1, level: 'CERTIFIED' }],
        household: { membership: { status: 'ACTIVE' } },
        ...overrides,
    };
}

describe('assignParticipantClaims — household login gate', () => {
    it('forces denied=true and strips every authority flag for a DENIED household', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({ household: { membership: { status: 'DENIED' } } }));

        expect(token.denied).toBe(true);
        expect(token.sysadmin).toBe(false);
        expect(token.keyholder).toBe(false);
        expect(token.boardMember).toBe(false);
        expect(token.shopSteward).toBe(false);
        expect(token.backgroundCheckReviewer).toBe(false);
        expect(token.toolStatuses).toEqual([]);
        // Identity is preserved so the session still resolves and the gate can act.
        expect(token.id).toBe(7);
        expect(token.householdId).toBe(99);
    });

    it('preserves roles for an ACTIVE household', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant());

        expect(token.denied).toBe(false);
        expect(token.sysadmin).toBe(true);
        expect(token.keyholder).toBe(true);
        expect(token.toolStatuses).toHaveLength(1);
    });

    it.each(['NONE', 'REVOKED', undefined] as const)(
        'does not deny for non-DENIED status: %s',
        (status) => {
            const token = {} as JWT;
            const household = status === undefined ? null : { membership: { status } };
            assignParticipantClaims(token, participant({ household }));

            expect(token.denied).toBe(false);
            expect(token.keyholder).toBe(true);
        },
    );
});
