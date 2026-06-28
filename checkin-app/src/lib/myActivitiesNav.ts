/**
 * Single source of truth for the My Activities tabs. Rendered as the persistent
 * top tabs (my-activities/layout.tsx); /my-activities itself redirects to the first tab.
 */
export interface MyActivitiesNavLink {
  name: string;
  href: string;
  icon: string;
}

export const MY_ACTIVITIES_NAV_LINKS: MyActivitiesNavLink[] = [
  { name: "My Events", href: "/my-activities/events", icon: "📅" },
  { name: "My Programs", href: "/my-activities/programs", icon: "📚" },
];
