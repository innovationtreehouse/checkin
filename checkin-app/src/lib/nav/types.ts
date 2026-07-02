/**
 * Shared shape for a section-nav link (the persistent top tabs). Each section
 * keeps its own data array (FACILITY_NAV_LINKS etc.) — only the link type is shared.
 *
 * shopNav/systemStatusNav keep their own types: they add gating fields (`visible`,
 * `sysadminOnly`) and system-status links carry no icon.
 */
export interface NavLink {
  name: string;
  href: string;
  icon: string;
  /** One-line description shown on the hub landing grid (not in the tabs). */
  description?: string;
}
