/**
 * Single source of truth for the Facility Ops tools. Rendered as the persistent
 * top tabs (facility/layout.tsx); /facility itself redirects to the first tab.
 */
import type { NavLink } from "@/lib/nav/types";

export const FACILITY_NAV_LINKS: NavLink[] = [
  { name: "Visit History", href: "/facility-ops/visits", icon: "🕒" },
  { name: "Raw Badge Events", href: "/facility-ops/badges", icon: "📡" },
  { name: "Print ID Badges", href: "/facility-ops/print-badges", icon: "🖨️" },
  { name: "Badge Prints", href: "/facility-ops/badge-prints", icon: "🪪" },
  { name: "Participation Trends", href: "/facility-ops/trends", icon: "📈" },
];
