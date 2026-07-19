import type { JWT } from "next-auth/jwt";
import type { OrgMembershipStatus, PersonRoleKind } from "@/generated/prisma/client";
import { orgMembershipStatusBlocksLogin } from "@/lib/orgMembership";
import { ROLE_FLAGS, rolesToFlags } from "@/lib/roles";

/** The participant fields the JWT carries, plus the household membership the login gate reads. */
export type ClaimSourceParticipant = {
    id: number;
    // Source of truth for the five authority booleans (see lib/roles.ts rolesToFlags).
    roles: { role: PersonRoleKind }[];
    householdId: number;
    toolStatuses: { toolId: number; level: string }[];
    // Leadership of their own household. Single source of truth (a1) — supersedes
    // the former HouseholdLead join.
    isHouseholdLead: boolean;
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
    const f = rolesToFlags(p.roles);

    token.id = p.id;
    token.denied = denied;
    for (const flag of ROLE_FLAGS) {
        token[flag] = denied ? false : f[flag];
    }
    token.householdId = p.householdId;
    token.householdLead = denied ? false : p.isHouseholdLead;
    token.toolStatuses = denied ? [] : p.toolStatuses;
    token.programsLed = denied ? [] : (p.programsLed?.map((prog) => prog.id) ?? []);
}
