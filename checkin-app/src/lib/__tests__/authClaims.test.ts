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
            const household = status === undefined ? null : { membership: { status } };
            assignParticipantClaims(token, participant({ household }));

            expect(token.denied).toBe(false);
            expect(token.isKeyholder).toBe(true);
        },
    );
});

describe('assignParticipantClaims — householdLead claim', () => {
    it('stamps householdLead=true when a HouseholdLead row exists', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({ householdLeads: [{ participantId: 7 }] }));
        expect(token.householdLead).toBe(true);
    });

    it('stamps householdLead=false when no HouseholdLead row exists', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({ householdLeads: [] }));
        expect(token.householdLead).toBe(false);
    });

    it('forces householdLead=false for a DENIED household even with a lead row', () => {
        const token = {} as JWT;
        assignParticipantClaims(token, participant({
            householdLeads: [{ participantId: 7 }],
            household: { membership: { status: 'DENIED' } },
        }));
        expect(token.householdLead).toBe(false);
    });
});
