/**
 * Single source of truth for the Membership Ops tools. Rendered as the top tab
 * bar in membership-ops/layout.tsx; the hub (/membership-ops) redirects to the
 * first entry. Add a tool once here and it shows up as a tab.
 */
import type { NavLink } from "@/lib/nav/types";

export const MEMBERSHIP_OPS_NAV_LINKS: NavLink[] = [
  { name: "Participants", href: "/membership-ops/participants", icon: "👥" },
  // The hold reason (the merge route blind-deleted the merge-side join row on
  // collision, silently downgrading data — higher cert, ACTIVE-over-PENDING, payment
  // metadata) is dissolved: the merge route now deletes nothing — on a collision both
  // rows survive and the tombstone's row is excluded from every count/roster
  // (lib/person/filters.ts). Nothing is destroyed, so there is nothing to reconcile.
  { name: "Merge Participants", href: "/membership-ops/participants/merge", icon: "🔗" },
  { name: "Households", href: "/membership-ops/households", icon: "🏠" },
  { name: "Volunteer Memberships", href: "/membership-ops/volunteer-memberships", icon: "🙋" },
  { name: "Applications", href: "/membership-ops/applications", icon: "📋" },
  // "Unclaimed Accounts" moved to Membership Audit (/membership-audit/unclaimed).
  { name: "Background-check Review", href: "/membership-ops/review", icon: "🔍" },
  // "Broken Households" moved to Membership Audit (/membership-audit/broken).
];
