/**
 * Single source of truth for the Membership Ops tools. Rendered both as the
 * persistent sidebar (membership-ops/layout.tsx) and as the landing card grid
 * on the Membership Ops hub (/membership-ops). Add a tool once here and it
 * shows up in both.
 */
export interface MembershipOpsNavLink {
  name: string;
  href: string;
  icon: string;
  /** One-line description shown on the hub landing grid (not in the sidebar). */
  description?: string;
}

export const MEMBERSHIP_OPS_NAV_LINKS: MembershipOpsNavLink[] = [
  { name: "Participants", href: "/membership-ops/participants", icon: "👥", description: "Browse and manage participant profiles." },
  { name: "Merge Participants", href: "/membership-ops/participants/merge", icon: "🔗", description: "Combine duplicate participant records." },
  { name: "Manage Memberships", href: "/membership-ops/households", icon: "🏠", description: "Grant or revoke household facility membership." },
  { name: "Membership Applications", href: "/membership-ops/applications", icon: "📋", description: "Review and approve membership applications." },
];
