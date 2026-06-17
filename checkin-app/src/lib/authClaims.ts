import type { JWT } from "next-auth/jwt";
import type { MembershipStatus } from "@/generated/prisma/client";
import { membershipStatusBlocksLogin } from "@/lib/membership";

/** The participant fields the JWT carries, plus the household membership the login gate reads. */
export type ClaimSourceParticipant = {
    id: number;
    sysadmin: boolean;
    keyholder: boolean;
    boardMember: boolean;
    backgroundCheckReviewer: boolean;
    householdId: number;
    toolStatuses: { toolId: number; level: string }[];
    household?: { membership?: { status: MembershipStatus } | null } | null;
};

/**
 * Stamp a participant's authority claims onto the JWT, applying the household login gate.
 *
 * Single source of truth shared by both jwt-callback branches (fresh sign-in and per-request
 * refresh). When the household membership is DENIED the account is locked out: the id is kept
 * (so the session still resolves and the /access-denied gate can identify the state) but every
 * authority flag is forced false and tool statuses are cleared, so nothing downstream honors it.
 */
export function assignParticipantClaims(token: JWT, p: ClaimSourceParticipant): void {
    const denied = membershipStatusBlocksLogin(p.household?.membership?.status);

    token.id = p.id;
    token.denied = denied;
    token.sysadmin = denied ? false : p.sysadmin;
    token.keyholder = denied ? false : p.keyholder;
    token.boardMember = denied ? false : p.boardMember;
    token.backgroundCheckReviewer = denied ? false : p.backgroundCheckReviewer;
    token.householdId = p.householdId;
    token.toolStatuses = denied ? [] : p.toolStatuses;
}
