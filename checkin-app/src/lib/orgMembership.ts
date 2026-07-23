import type { OrgMembershipStatus, Prisma } from "@/generated/prisma/client";
import prisma from "@/lib/prisma";
import { nextBoundary, renewalSeasonWindow } from "@/lib/membership/renewal";

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

/**
 * How far a household's membership currently covers, as a boundary date — or
 * null when no horizon can be computed (not ACTIVE, or the board hasn't set
 * {@link BoardSettings.orgMembershipYearBoundary}). A membership always runs
 * boundary-to-boundary: an un-renewed ACTIVE household is covered through the
 * UPCOMING boundary; one already "settled for the coming year" (a terminal
 * ACTIVE {@link OrgMembershipProcess} stamped inside this cycle's renewal
 * window — the same probe households-ops uses for its `settledForComingYear`
 * flag) is covered one boundary further.
 */
export async function membershipValidThrough(householdId: number, now = new Date()): Promise<Date | null> {
    const household = await prisma.household.findUnique({
        where: { id: householdId },
        select: { orgMembership: { select: { id: true, status: true } } },
    });
    if (household?.orgMembership?.status !== "ACTIVE") return null;

    const settings = await prisma.boardSettings.findUnique({
        where: { id: 1 },
        select: { orgMembershipYearBoundary: true },
    });
    if (!settings?.orgMembershipYearBoundary) return null;

    const boundary = nextBoundary(settings.orgMembershipYearBoundary, now);
    const window = await renewalSeasonWindow(now);
    const settled = (await prisma.orgMembershipProcess.findFirst({
        where: {
            orgMembershipId: household.orgMembership.id,
            status: "ACTIVE",
            stageEnteredAt: { gte: window?.windowStart ?? new Date(8.64e15) },
        },
        select: { id: true },
    })) !== null;

    return settled
        ? new Date(Date.UTC(boundary.getUTCFullYear() + 1, boundary.getUTCMonth(), boundary.getUTCDate()))
        : boundary;
}

/**
 * Does this Person's org membership cover a program running through `through`?
 * `through === null` means the program has no dates to compare against, so
 * today's status-only behavior applies. When a horizon CAN'T be computed (no
 * boundary configured) an ACTIVE membership still passes — preserves current
 * behavior rather than penalizing every member for a board settings gap.
 */
export async function isActiveOrgMemberThrough(personId: number, through: Date | null): Promise<boolean> {
    if (!(await isActiveOrgMember(personId))) return false;
    if (through === null) return true;

    const person = await prisma.person.findUnique({ where: { id: personId }, select: { householdId: true } });
    const validThrough = person ? await membershipValidThrough(person.householdId) : null;
    if (validThrough === null) return true;

    const throughDay = Date.UTC(through.getUTCFullYear(), through.getUTCMonth(), through.getUTCDate());
    const validDay = Date.UTC(validThrough.getUTCFullYear(), validThrough.getUTCMonth(), validThrough.getUTCDate());
    return validDay >= throughDay;
}

/**
 * The date a program's member pricing must be valid through: its end date, or
 * (an ongoing program with no end) its start date. Shared by the discount-code
 * route and the program detail route so both apply the same coverage rule.
 * POLICY (flag for veto): an ongoing program (endAt null) requires validity
 * only through its START, not indefinitely.
 */
export function programCoverageDate(p: { startAt: Date | null; endAt: Date | null }): Date | null {
    return p.endAt ?? p.startAt ?? null;
}
