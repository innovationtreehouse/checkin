import type { MembershipStatus, Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";

/**
 * Canonical "is this person an active member?" read model.
 *
 * Each household has one Membership (1:1). A Participant counts as an active
 * member when their household's membership has status ACTIVE. This is the single
 * source of truth for member gating — route every "is member?" check through
 * here so a child or second parent in an active household is honored.
 */
export const ACTIVE_MEMBER_PARTICIPANT_WHERE: Prisma.ParticipantWhereInput = {
    household: { membership: { status: "ACTIVE" } },
};

/**
 * Prisma `include` fragment that loads exactly the membership data
 * `participantRecordIsActiveMember` needs (the household's membership).
 * Spread into a findMany/findUnique `include` to compute membership in-query
 * without an extra round-trip.
 */
export const ACTIVE_MEMBER_INCLUDE = {
    household: { include: { membership: true } },
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
 * membership; a missing household or membership reads as "not a member".
 */
export function participantRecordIsActiveMember(p: {
    household?: { membership?: { status: MembershipStatus } | null } | null;
}): boolean {
    return p.household?.membership?.status === "ACTIVE";
}
