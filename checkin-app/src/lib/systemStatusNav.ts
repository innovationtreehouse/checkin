/**
 * Single source of truth for the System Status tools. Rendered as the persistent
 * top tabs (system-status/layout.tsx); /system-status itself redirects to the first tab.
 */
import type { NavLink } from "@/lib/nav/types";

export interface SystemStatusNavLink extends NavLink {
  /** Tab visible only to sysadmins (e.g. the Audit Log). */
  sysadminOnly?: boolean;
}

export const SYSTEM_STATUS_NAV_LINKS: SystemStatusNavLink[] = [
  { name: "System Status", href: "/system-status/health", icon: "💚" },
  { name: "Link Status", href: "/system-status/links", icon: "🔗" },
  { name: "Errors", href: "/system-status/errors", icon: "🚨" },
  { name: "Audit Log", href: "/system-status/audit-log", icon: "📜", sysadminOnly: true },
];
