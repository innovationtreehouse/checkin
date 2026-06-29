/**
 * Single source of truth for the Facility Ops tools. Rendered as the persistent
 * top tabs (facility/layout.tsx); /facility itself redirects to the first tab.
 */
export interface FacilityNavLink {
  name: string;
  href: string;
  icon: string;
  /** One-line description shown on the hub landing grid (not in the tabs). */
  description?: string;
}

export const FACILITY_NAV_LINKS: FacilityNavLink[] = [
  { name: "Visit History", href: "/facility-ops/visits", icon: "🕒", description: "View and edit past visit records." },
  { name: "Raw Badge Events", href: "/facility-ops/badges", icon: "📡", description: "Audit the raw RFID badge tap log." },
  { name: "Print ID Badges", href: "/facility-ops/print-badges", icon: "🖨️", description: "Generate printable participant ID badges." },
  { name: "Participation Trends", href: "/facility-ops/trends", icon: "📈", description: "Attendance and participation analytics." },
];
