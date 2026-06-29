/**
 * Single source of truth for the Program Ops tools. Rendered as the persistent
 * top tabs (program-ops/layout.tsx); /program-ops itself redirects to the first tab.
 *
 * ponytail: program/event *detail* pages (programs/[id], events/new, events/[id])
 * stay under /admin and self-gate via isProgramFlow — drilling into a detail leaves
 * the tab chrome. Relocate them under /program-ops too if that inconsistency matters.
 */
export interface ProgramNavLink {
  name: string;
  href: string;
  icon: string;
  /** One-line description shown on the hub landing grid (not in the tabs). */
  description?: string;
}

export const PROGRAM_NAV_LINKS: ProgramNavLink[] = [
  { name: "All Programs", href: "/program-ops/programs", icon: "📚", description: "Browse and manage recurring programs." },
  { name: "New Program", href: "/program-ops/new", icon: "✨", description: "Create a new program or curriculum track." },
  { name: "One Time Events", href: "/program-ops/events", icon: "📋", description: "Browse all one-off / standalone events." },
  { name: "New One Time Event", href: "/program-ops/sessions", icon: "📅", description: "Schedule a one-off event or manual session." },
];
