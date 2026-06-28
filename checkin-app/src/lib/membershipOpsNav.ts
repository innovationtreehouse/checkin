/**
 * Single source of truth for the Membership Ops tools. Rendered as the top tab
 * bar in membership-ops/layout.tsx; the hub (/membership-ops) redirects to the
 * first entry. Add a tool once here and it shows up as a tab.
 */
export interface MembershipOpsNavLink {
  name: string;
  href: string;
  icon: string;
  description?: string;
}

export const MEMBERSHIP_OPS_NAV_LINKS: MembershipOpsNavLink[] = [
  { name: "Participants", href: "/membership-ops/participants", icon: "👥", description: "Browse and manage participant profiles." },
  { name: "Merge Participants", href: "/membership-ops/participants/merge", icon: "🔗", description: "Combine duplicate participant records." },
  { name: "Manage Memberships", href: "/membership-ops/households", icon: "🏠", description: "Grant or revoke household facility membership." },
  { name: "Membership Applications", href: "/membership-ops/applications", icon: "📋", description: "Review and approve membership applications." },
];
