/**
 * Single source of truth for the My Activities tabs. Rendered as the persistent
 * top tabs (my-activities/layout.tsx); /my-activities itself redirects to the first tab.
 */
import type { NavLink } from "@/lib/nav/types";

export const MY_ACTIVITIES_NAV_LINKS: NavLink[] = [
  { name: "My Events", href: "/my-activities/events", icon: "📅" },
  { name: "My Programs", href: "/my-activities/programs", icon: "📚" },
];
