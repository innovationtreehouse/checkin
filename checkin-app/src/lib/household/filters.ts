import type { Prisma } from "@/generated/prisma/client";

/**
 * Shared Household `where` fragments for the "who needs a lead" surfaces (a1:
 * leadership is `Person.isHouseholdLead`). These were copy-pasted across the
 * broken-households admin list, the membership-audit unclaimed list, and the nav
 * todo-count badge — with a comment begging them to stay in sync. Define once so
 * the list and its count can't diverge.
 */

/**
 * "Active" == not archived. The single source of truth for the soft-archive
 * filter — compose this into any household list/cron/fan-out that should skip
 * archived families, rather than sprinkling `archivedAt: null` ad hoc.
 * See docs/designs/HOUSEHOLD_ARCHIVE.md.
 */
export const ACTIVE_HOUSEHOLD_WHERE: Prisma.HouseholdWhereInput = { archivedAt: null };

/** Person-scoped variant: "this person's household isn't archived." For person list/fan-out queries. */
export const ACTIVE_HOUSEHOLD_PERSON_WHERE: Prisma.PersonWhereInput = { household: { archivedAt: null } };

/** "Broken": a household with no lead at all (incl. empty households). Archived families excluded. */
export const BROKEN_HOUSEHOLD_WHERE: Prisma.HouseholdWhereInput = {
    archivedAt: null,
    householdMembers: { none: { isHouseholdLead: true } },
};

/**
 * Households to chase on the membership audit / nav badge:
 *   1. Unclaimed-with-lead: a lead has an email to chase, but no lead has signed in
 *      with Google yet (a claimed lead covers the whole household).
 *   2. Broken: no lead at all — no email requirement (may have no contactable member).
 * The audit list route and the nav count MUST use this same predicate or they drift.
 */
export const UNCLAIMED_OR_BROKEN_HOUSEHOLD_WHERE: Prisma.HouseholdWhereInput = {
    // Top-level archivedAt:null gates BOTH OR branches (the OR alone would let the
    // "unclaimed-with-lead" branch match an archived household).
    archivedAt: null,
    OR: [
        {
            householdMembers: { some: { isHouseholdLead: true, email: { not: null } } },
            NOT: { householdMembers: { some: { isHouseholdLead: true, googleId: { not: null } } } },
        },
        BROKEN_HOUSEHOLD_WHERE,
    ],
};
