/**
 * Single source of truth for the Facility Ops tools. Rendered as the persistent
 * top tabs (facility/layout.tsx); /facility itself redirects to the first tab.
 */
export interface FacilityNavLink {
  name: string;
  href: string;
  icon: string;
}

export const FACILITY_NAV_LINKS: FacilityNavLink[] = [
  { name: "Visit History", href: "/facility-ops/visits", icon: "🕒" },
  { name: "Raw Badge Events", href: "/facility-ops/badges", icon: "📡" },
  { name: "Print ID Badges", href: "/facility-ops/print-badges", icon: "🖨️" },
  { name: "Participation Trends", href: "/facility-ops/trends", icon: "📈" },
];
