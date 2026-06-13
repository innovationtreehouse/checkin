/**
 * Single source of truth for the admin tools. Rendered both as the persistent
 * sidebar (admin/layout.tsx) and as the landing card grid on the Admin Hub
 * (/admin, CUJ 7.1). Add a tool once here and it shows up in both places.
 */
export interface AdminNavLink {
  name: string;
  href: string;
  icon: string;
  /** One-line description shown on the hub landing grid (not in the sidebar). */
  description?: string;
}

export interface AdminNavSection {
  title: string;
  links: AdminNavLink[];
}

export const ADMIN_NAV_SECTIONS: AdminNavSection[] = [
  {
    title: "Dashboard",
    links: [{ name: "Dashboard", href: "/admin", icon: "📊" }],
  },
  {
    title: "Operations",
    links: [
      { name: "Visit History", href: "/admin/events/visits", icon: "🕒", description: "View and edit past visit records." },
      { name: "Raw Badge Events", href: "/admin/events/badges", icon: "📡", description: "Audit the raw RFID badge tap log." },
      { name: "Print ID Badges", href: "/admin/print-badges", icon: "🖨️", description: "Generate printable participant ID badges." },
      { name: "Participation Trends", href: "/admin/trends", icon: "📈", description: "Attendance and participation analytics." },
      { name: "System Health", href: "/admin/systemhealth", icon: "🫀", description: "Service and integration status." },
    ],
  },
  {
    title: "People",
    links: [
      { name: "Participants", href: "/admin/participants", icon: "👥", description: "Browse and manage participant profiles." },
      { name: "Merge Participants", href: "/admin/participants/merge", icon: "🔗", description: "Combine duplicate participant records." },
      { name: "Manage Memberships", href: "/admin/households", icon: "🏠", description: "Grant or revoke household facility membership." },
      { name: "Membership Applications", href: "/admin/membership", icon: "📋", description: "Review and approve membership applications." },
      { name: "Membership Settings", href: "/admin/membership/settings", icon: "⚙️", description: "Configure dues and membership-year settings." },
      { name: "Pending Participants", href: "/admin/programs/pending", icon: "⏳", description: "Approve pending payment-plan requests." },
      { name: "Emergency Contacts", href: "/admin/emergency-contacts", icon: "🚑", description: "View participant emergency contacts." },
      { name: "Safety Links", href: "/admin/safety-links", icon: "🔗", description: "Review board-approved dual relationships." },
      { name: "Role Assignment", href: "/admin/roles", icon: "🔐", description: "Assign admin / board / keyholder roles." },
    ],
  },
];
