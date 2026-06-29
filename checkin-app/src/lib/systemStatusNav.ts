/**
 * Single source of truth for the System Status tools. Rendered as the persistent
 * top tabs (system-status/layout.tsx); /system-status itself redirects to the first tab.
 */
export interface SystemStatusNavLink {
  name: string;
  href: string;
  /** Tab visible only to sysadmins (e.g. the Audit Log). */
  sysadminOnly?: boolean;
}

export const SYSTEM_STATUS_NAV_LINKS: SystemStatusNavLink[] = [
  { name: "System Status", href: "/system-status/health" },
  { name: "Link Status", href: "/system-status/links" },
  { name: "Errors", href: "/system-status/errors" },
  { name: "Audit Log", href: "/system-status/audit-log", sysadminOnly: true },
];
