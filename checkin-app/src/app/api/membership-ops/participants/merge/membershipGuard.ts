import type { OrgMembershipStatus } from "@/generated/prisma/client";

/** A household with no OrgMembership row has never been a Treehouse Member. */
export function householdMembershipStatus(
    household: { orgMembership?: { status: OrgMembershipStatus } | null } | null | undefined,
): OrgMembershipStatus {
    return household?.orgMembership?.status ?? "NONE";
}

/** Negative state: these restrict a household rather than granting it anything. */
function isRestricted(status: OrgMembershipStatus): boolean {
    return status === "DENIED" || status === "REVOKED";
}

export type MergeSubjectMembership = {
    status: OrgMembershipStatus;
    /** Live (un-merged) members of this household other than the merge subject itself. */
    liveOthers: number;
};

/**
 * Why this merge must be refused on household membership grounds, or null.
 *
 * OrgMembership is 1:1 with Household and a merge never moves it: the tombstone
 * keeps its householdId and the keeper stays in its own household. Two harms
 * follow, and both are asymmetric — which side is merged away decides them.
 *
 * 1. A restriction on one side only. `denied` is derived live from the person's
 *    CURRENT household (lib/authClaims.ts), so merging across a DENIED/REVOKED
 *    boundary changes which restriction the surviving human carries.
 * 2. An ACTIVE membership left with no live member. Only ACTIVE carries value
 *    worth stranding — NONE grants nothing and DENIED/REVOKED are negative
 *    state, so a live-empty household in those states strands nothing.
 *
 * A duplicate sitting alone in its own membership-less household — what every
 * fresh Google sign-in gets from createParticipantWithHousehold — is the
 * ordinary dedupe, and stays mergeable into a keeper of any status.
 */
export function membershipMergeBlock(
    keep: { status: OrgMembershipStatus },
    merge: MergeSubjectMembership,
): string | null {
    if (keep.status !== merge.status && (isRestricted(keep.status) || isRestricted(merge.status))) {
        return `Cannot merge: the kept record's household is ${keep.status} and the merged-away record's household is ${merge.status}. Login and facility access are read from the surviving record's household, so this merge would change which restriction applies to this person. Settle that first — assign the person to the right household from the Participants page, or set the household's membership on the Households page — then merge.`;
    }

    if (merge.status === "ACTIVE" && merge.liveOthers === 0) {
        return `Cannot merge: the merged-away record is the last live member of a household holding an ACTIVE Treehouse membership, and the kept record is in a different household (${keep.status}). The merge would leave that membership with nobody in it. Swap which record is kept, or assign the kept record to that household from the Participants page, then merge.`;
    }

    return null;
}
