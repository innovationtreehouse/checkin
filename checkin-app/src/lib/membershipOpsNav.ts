/**
 * Single source of truth for the Membership Ops tools. Rendered as the top tab
 * bar in membership-ops/layout.tsx; the hub (/membership-ops) redirects to the
 * first entry. Add a tool once here and it shows up as a tab.
 */
import type { NavLink } from "@/lib/nav/types";
import type { SessionUser } from "@/types/auth";

/**
 * Background-check reviewers and board members (implicit reviewers) may open the
 * Review tab; every other Membership Ops tool is admin-only. One definition the
 * layout gate and the /index directory both read, so they cannot drift (#1569).
 */
export function canReviewBackgroundChecks(
  user: Pick<SessionUser, "isBackgroundCheckReviewer" | "isBoardMember"> | undefined,
): boolean {
  return !!user?.isBackgroundCheckReviewer || !!user?.isBoardMember;
}

export const MEMBERSHIP_OPS_NAV_LINKS: NavLink[] = [
  { name: "Participants", href: "/membership-ops/participants", icon: "👥" },
  // The hold reason (the merge route blind-deleted the merge-side join row on
  // collision, silently downgrading data — higher cert, ACTIVE-over-PENDING, payment
  // metadata) is dissolved: the merge route now deletes nothing — on a collision both
  // rows survive and the tombstone's row is excluded from every count/roster
  // (lib/person/filters.ts). Nothing is destroyed, so there is nothing to reconcile.
  { name: "Merge Participants", href: "/membership-ops/participants/merge", icon: "🔗" },
  { name: "Households", href: "/membership-ops/households", icon: "🏠" },
  { name: "Volunteers", href: "/membership-ops/volunteer-memberships", icon: "🙋" },
  { name: "Applications", href: "/membership-ops/applications", icon: "📋" },
  // "Unclaimed Accounts" moved to Membership Audit (/membership-audit/unclaimed).
  { name: "Background-check Review", href: "/membership-ops/review", icon: "🔍" },
  // "Broken Households" moved to Membership Audit (/membership-audit/broken).
  { name: "Roles", href: "/membership-ops/roles", icon: "🔑" },
];
