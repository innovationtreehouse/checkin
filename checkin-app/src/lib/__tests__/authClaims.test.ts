import type { JWT } from 'next-auth/jwt';
import { assignParticipantClaims, type ClaimSourceParticipant } from '@/lib/authClaims';

function participant(overrides: Partial<ClaimSourceParticipant> = {}): ClaimSourceParticipant {
    return {
        id: 7,
        isSysadmin: true,
        isKeyholder: true,
        isBoardMember: true,
        isBackgroundCheckReviewer: true,
        householdId: 99,
        isHouseholdLead: false,
        toolStatuses: [{ toolId: 1, level: 'CERTIFIED' }],
        household: { orgMembership: { status: 'ACTIVE' } },
        ...overrides,
    };
}

describe('assignParticipantClaims — household login gate', () => {
    it('forces denied=true and strips every authority flag for a DENIED household', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({ household: { orgMembership: { status: 'DENIED' } } }));

        expect(token.denied).toBe(true);
        expect(token.isSysadmin).toBe(false);
        expect(token.isKeyholder).toBe(false);
        expect(token.isBoardMember).toBe(false);
        expect(token.isBackgroundCheckReviewer).toBe(false);
        expect(token.toolStatuses).toEqual([]);
        // Identity is preserved so the session still resolves and the gate can act.
        expect(token.id).toBe(7);
        expect(token.householdId).toBe(99);
    });

    it('preserves roles for an ACTIVE household', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant());

        expect(token.denied).toBe(false);
        expect(token.isSysadmin).toBe(true);
        expect(token.isKeyholder).toBe(true);
        expect(token.toolStatuses).toHaveLength(1);
    });

    it.each(['NONE', 'REVOKED', undefined] as const)(
        'does not deny for non-DENIED status: %s',
        (status) => {
            const token = {} as JWT;
            const household = status === undefined ? null : { orgMembership: { status } };
            assignParticipantClaims(token, participant({ household }));

            expect(token.denied).toBe(false);
            expect(token.isKeyholder).toBe(true);
        },
    );
});

describe('assignParticipantClaims — householdLead claim', () => {
    it('stamps householdLead=true when isHouseholdLead is set', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({ isHouseholdLead: true }));
        expect(token.householdLead).toBe(true);
    });

    it('stamps householdLead=false when isHouseholdLead is unset', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({ isHouseholdLead: false }));
        expect(token.householdLead).toBe(false);
    });

    it('forces householdLead=false for a DENIED household even when isHouseholdLead is set', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({
            isHouseholdLead: true,
            household: { orgMembership: { status: 'DENIED' } },
        }));
        expect(token.householdLead).toBe(false);
    });
});
