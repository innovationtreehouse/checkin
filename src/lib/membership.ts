import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

/**
 * Canonical "is this person an active member?" read model.
 *
 * A Participant counts as an active member when EITHER:
 *   - their household holds an active Membership, OR
 *   - they personally hold an active Membership (legacy individual/volunteer link).
 *
 * This is the single source of truth for member gating. Several call sites
 * historically checked only `participant.memberships` (own-only), which wrongly
 * excluded a child or second parent whose membership lives on the household.
 * Route those through here instead.
 *
 * NOTE: the individual-membership leg is legacy. When the schema cutover (PR4)
 * drops per-participant memberships, collapse this to household-only in ONE
 * place — here — and every consumer follows automatically.
 */
export const ACTIVE_MEMBER_PARTICIPANT_WHERE: Prisma.ParticipantWhereInput = {
    OR: [
        { household: { memberships: { some: { active: true } } } },
        { memberships: { some: { active: true } } },
    ],
};

/**
 * Prisma `include` fragment that loads exactly the membership data
 * `participantRecordIsActiveMember` needs (household + own active memberships).
 * Spread into a findMany/findUnique `include` to compute membership in-query
 * without an extra round-trip.
 */
export const ACTIVE_MEMBER_INCLUDE = {
    memberships: { where: { active: true } },
    household: { include: { memberships: { where: { active: true } } } },
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
 * extra query would be wasteful. Accepts any record shaped with the relevant
 * relations; missing relations read as "not a member".
 */
export function participantRecordIsActiveMember(p: {
    memberships?: { active: boolean }[] | null;
    household?: { memberships?: { active: boolean }[] | null } | null;
}): boolean {
    return (
        (p.memberships?.some((m) => m.active) ?? false) ||
        (p.household?.memberships?.some((m) => m.active) ?? false)
    );
}
