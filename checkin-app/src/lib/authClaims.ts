import type { JWT } from "next-auth/jwt";
import type { OrgMembershipStatus } from "@/generated/prisma/client";
import { orgMembershipStatusBlocksLogin } from "@/lib/orgMembership";

/** The participant fields the JWT carries, plus the household membership the login gate reads. */
export type ClaimSourceParticipant = {
    id: number;
    isSysadmin: boolean;
    isKeyholder: boolean;
    isBoardMember: boolean;
    isBackgroundCheckReviewer: boolean;
    householdId: number;
    toolStatuses: { toolId: number; level: string }[];
    // Any row here means this participant leads a household (the relation is already
    // filtered to their own leads). Empty/absent → not a lead.
    householdLeads?: { personId: number }[];
    // Programs this participant is the lead mentor of (Program.leadMentorId === id).
    // Drives the client-side program-ops row gate; mirrors access-resolvers' programsLed.
    programsLed?: { id: number }[];
    household?: { orgMembership?: { status: OrgMembershipStatus } | null } | null;
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
    const denied = orgMembershipStatusBlocksLogin(p.household?.orgMembership?.status);

    token.id = p.id;
    token.denied = denied;
    token.isSysadmin = denied ? false : p.isSysadmin;
    token.isKeyholder = denied ? false : p.isKeyholder;
    token.isBoardMember = denied ? false : p.isBoardMember;
    token.isBackgroundCheckReviewer = denied ? false : p.isBackgroundCheckReviewer;
    token.householdId = p.householdId;
    token.householdLead = denied ? false : (p.householdLeads?.length ?? 0) > 0;
    token.toolStatuses = denied ? [] : p.toolStatuses;
    token.programsLed = denied ? [] : (p.programsLed?.map((prog) => prog.id) ?? []);
}
