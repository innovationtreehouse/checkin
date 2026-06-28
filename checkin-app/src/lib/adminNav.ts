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
    title: "People",
    links: [
      { name: "Membership Settings", href: "/admin/membership/settings", icon: "⚙️", description: "Configure dues and membership-year settings." },
      { name: "Role Assignment", href: "/admin/roles", icon: "🔐", description: "Assign admin / board / keyholder roles." },
    ],
  },
];
