import type { OrgMembershipStatus, Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * Canonical "is this person an active Treehouse Member?" read model.
 *
 * Each household has one Membership (1:1). A Person counts as an active org
 * member when their household's membership has status ACTIVE. This is the single
 * source of truth for org-member gating — route every "is org member?" check
 * through here so a child or second parent in an active household is honored.
 */
export const ACTIVE_ORG_MEMBER_PERSON_WHERE: Prisma.PersonWhereInput = {
    household: { orgMembership: { status: "ACTIVE" } },
};

/**
 * Prisma `include` fragment that loads exactly the membership data
 * `personRecordIsActiveOrgMember` needs (the household's membership).
 * Spread into a findMany/findUnique `include` to compute org membership in-query
 * without an extra round-trip.
 */
export const ACTIVE_ORG_MEMBER_INCLUDE = {
    household: { include: { orgMembership: true } },
} satisfies Prisma.PersonInclude;

/**
 * Does the Person with this id currently count as an active Treehouse Member?
 * One indexed existence check; returns false for unknown ids.
 */
export async function isActiveOrgMember(personId: number): Promise<boolean> {
    if (!Number.isInteger(personId)) return false;
    const match = await prisma.person.findFirst({
        where: { AND: [{ id: personId }, ACTIVE_ORG_MEMBER_PERSON_WHERE] },
        select: { id: true },
    });
    return match !== null;
}

/**
 * Pure predicate over an already-loaded Person record. Use when a query has
 * already pulled membership data (e.g. via {@link ACTIVE_ORG_MEMBER_INCLUDE}) and an
 * extra query would be wasteful. Accepts any record whose household carries its
 * membership; a missing household or membership reads as "not an org member".
 */
export function personRecordIsActiveOrgMember(p: {
    household?: { orgMembership?: { status: OrgMembershipStatus } | null } | null;
}): boolean {
    return p.household?.orgMembership?.status === "ACTIVE";
}

/**
 * Does this membership status lock every household member out of login?
 *
 * Only DENIED blocks login. REVOKED is a softer state — a former Treehouse Member
 * who keeps app access but loses facility privileges. This is the single source of
 * truth for the login gate; the auth jwt callback and middleware both route through
 * it so a board "Deny Membership" action takes effect for every member of the household.
 */
export function orgMembershipStatusBlocksLogin(
    status: OrgMembershipStatus | null | undefined,
): boolean {
    return status === "DENIED";
}
