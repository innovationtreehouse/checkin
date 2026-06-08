import type { MembershipStatus, Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Canonical "is this person an active member?" read model.
 *
 * Memberships belong to the household. A Participant counts as an active member
 * when their household holds a membership with status ACTIVE. This is the single
 * source of truth for member gating — route every "is member?" check through
 * here so a child or second parent in an active household is honored.
 */
export const ACTIVE_MEMBER_PARTICIPANT_WHERE: Prisma.ParticipantWhereInput = {
    household: { memberships: { some: { status: "ACTIVE" } } },
};

/**
 * Prisma `include` fragment that loads exactly the membership data
 * `participantRecordIsActiveMember` needs (the household's active memberships).
 * Spread into a findMany/findUnique `include` to compute membership in-query
 * without an extra round-trip.
 */
export const ACTIVE_MEMBER_INCLUDE = {
    household: { include: { memberships: { where: { status: "ACTIVE" } } } },
} satisfies Prisma.ParticipantInclude;

/**
 * Does the Participant with this id currently count as an active member?
 * One indexed existence check; returns false for unknown ids.
 */
export async function isActiveMember(participantId: number): Promise<boolean> {
    if (!Number.isInteger(participantId)) return false;
    const match = await prisma.participant.findFirst({
        where: { AND: [{ id: participantId }, ACTIVE_MEMBER_PARTICIPANT_WHERE] },
        select: { id: true },
    });
    return match !== null;
}

/**
 * Pure predicate over an already-loaded Participant record. Use when a query has
 * already pulled membership data (e.g. via {@link ACTIVE_MEMBER_INCLUDE}) and an
 * extra query would be wasteful. Accepts any record whose household carries its
 * memberships; a missing household reads as "not a member".
 */
export function participantRecordIsActiveMember(p: {
    household?: { memberships?: { status: MembershipStatus }[] | null } | null;
}): boolean {
    return p.household?.memberships?.some((m) => m.status === "ACTIVE") ?? false;
}
