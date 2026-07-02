/**
 * Single source of truth for the dev-tools tabs, rendered as persistent top tabs
 * (app/dev/layout.tsx); /dev redirects to the first tab. Dev instances only — every
 * target page 404s off a dev instance and the "Debug" nav item is devOnly.
 */
export interface DevToolsNavLink {
  name: string;
  href: string;
}

export const DEV_TOOLS_NAV_LINKS: DevToolsNavLink[] = [
  { name: "Email", href: "/dev/sent-mail" },
  { name: "Sign", href: "/dev/zoho-sign" },
];
