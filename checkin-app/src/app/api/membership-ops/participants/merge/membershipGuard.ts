import type { OrgMembershipStatus } from "@/generated/prisma/client";

/** A household with no OrgMembership row has never been a Treehouse Member. */
export function householdMembershipStatus(
    household: { orgMembership?: { status: OrgMembershipStatus } | null } | null | undefined,
): OrgMembershipStatus {
    return household?.orgMembership?.status ?? "NONE";
}

/**
 * Both sides of a merge must sit on the same household membership status.
 *
 * OrgMembership is 1:1 with Household and a merge never moves it: the tombstone
 * keeps its householdId and the keeper stays in its own household. So a mismatch
 * either strands the tombstone household's membership (no live member left to
 * use it) or drops a DENIED/REVOKED restriction — the login gate derives `denied`
 * from the person's CURRENT household (lib/authClaims.ts), so the surviving human
 * stops inheriting it on the next token refresh.
 *
 * Returns the operator-facing reason, or null when the merge may proceed.
 */
export function membershipMergeBlock(
    keepStatus: OrgMembershipStatus,
    mergeStatus: OrgMembershipStatus,
): string | null {
    if (keepStatus === mergeStatus) return null;
    return `Cannot merge: these records are in households with different Treehouse membership status (kept record: ${keepStatus}, merged-away record: ${mergeStatus}). A merge never moves a membership, so this would either strand the membership or drop the restriction. Resolve the membership on these households first, then merge.`;
}
