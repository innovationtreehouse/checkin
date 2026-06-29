// Flat directory of every named (non-dynamic) app page, used by the /index
// page directory and available to any future command palette. Each entry's
// `visible` predicate mirrors the route's real gate (NAV_ITEMS[].visible +
// the section layout's useRequireRole). Over-listing here never grants access:
// every target re-enforces its own gate on arrival, so a drifted predicate at
// worst shows a link that 403s. See docs/designs/INDEX_PAGE_SCOPING.md.

export type RegistryUser = {
  sysadmin?: boolean;
  boardMember?: boolean;
  keyholder?: boolean;
  toolStatuses?: Array<{ level: string }>;
};

type Visible = (user: RegistryUser | undefined, signedIn: boolean) => boolean;

const PUBLIC: Visible = () => true;
const SIGNED_IN: Visible = (_u, signedIn) => signedIn;
const BOARD: Visible = (u) => !!u?.sysadmin || !!u?.boardMember;
const SYSADMIN: Visible = (u) => !!u?.sysadmin;
const SAFETY: Visible = (u) => !!u?.sysadmin || !!u?.boardMember || !!u?.keyholder;
const SHOP: Visible = (u) =>
  !!u?.sysadmin ||
  !!u?.boardMember ||
  !!u?.toolStatuses?.some((ts) => ts.level === 'MAY_CERTIFY_OTHERS');

export type PageEntry = {
  href: string;
  label: string;
  section: string;
  keywords?: string;
  visible: Visible;
};

export const PAGES: PageEntry[] = [
  // Personal — any signed-in member
  { href: '/my-household', label: 'My Household', section: 'Personal', visible: SIGNED_IN },
  { href: '/my-activities', label: 'My Activities', section: 'Personal', visible: SIGNED_IN },
  { href: '/my-activities/events', label: 'My Events', section: 'Personal', visible: SIGNED_IN },
  { href: '/my-activities/programs', label: 'My Programs', section: 'Personal', visible: SIGNED_IN },
  { href: '/profile', label: 'My Profile', section: 'Personal', visible: SIGNED_IN },
  // Staff home for program lead mentors. Lead status is computed per-request
  // (program.leadMentorId), not expressible from the session user here, so this
  // over-lists to all signed-in members; the page self-guards and redirects a
  // non-lead. Distinct from the attendee "My Programs" tab above.
  { href: '/my-programs', label: 'My Programs (Staff)', section: 'Personal', keywords: 'lead mentor program staff attendance', visible: SIGNED_IN },
  { href: '/membership', label: 'Membership Application', section: 'Personal', keywords: 'join intake', visible: SIGNED_IN },
  { href: '/trusted-adults', label: 'Trusted Adults', section: 'Personal', visible: SIGNED_IN },

  // Attendance — any signed-in member
  { href: '/attendance/current', label: 'Attendance', section: 'Attendance', visible: SIGNED_IN },
  { href: '/attendance/manual', label: 'Manual Check-In', section: 'Attendance', visible: SIGNED_IN },
  { href: '/attendance/household', label: 'Household Check-ins', section: 'Attendance', keywords: 'visits history dependents', visible: SIGNED_IN },
  { href: '/attendance/certifications', label: 'Certifications', section: 'Attendance', visible: SIGNED_IN },

  // Programs — public
  { href: '/programs', label: 'Programs', section: 'Programs', visible: PUBLIC },

  // Communication — signed-in member
  { href: '/communication', label: 'Communication', section: 'Personal', keywords: 'notifications email preferences settings', visible: SIGNED_IN },

  // Safety — board or keyholder
  { href: '/safety', label: 'Safety', section: 'Safety', visible: SAFETY },
  { href: '/safety/board-contacts', label: 'Board Contacts', section: 'Safety', visible: SAFETY },
  { href: '/safety/emergency-contacts', label: 'Emergency Contacts', section: 'Safety', visible: SAFETY },
  { href: '/safety/pickup', label: 'Pickup', section: 'Safety', visible: SAFETY },
  { href: '/safety/trusted-adults', label: 'Trusted Adults (Safety)', section: 'Safety', visible: SAFETY },

  // Shop Ops — board or certifier
  { href: '/shop-ops', label: 'Shop Ops', section: 'Shop Ops', visible: SHOP },
  { href: '/shop-ops/create', label: 'Create', section: 'Shop Ops', visible: SHOP },
  { href: '/shop-ops/live', label: 'Live', section: 'Shop Ops', visible: SHOP },
  { href: '/shop-ops/manage', label: 'Manage', section: 'Shop Ops', visible: SHOP },

  // Facility Ops — board
  { href: '/facility-ops', label: 'Facility Ops', section: 'Facility Ops', visible: BOARD },
  { href: '/facility-ops/badges', label: 'Badges', section: 'Facility Ops', visible: BOARD },
  { href: '/facility-ops/print-badges', label: 'Print Badges', section: 'Facility Ops', visible: BOARD },
  { href: '/facility-ops/trends', label: 'Trends', section: 'Facility Ops', visible: BOARD },
  { href: '/facility-ops/visits', label: 'Visits', section: 'Facility Ops', visible: BOARD },

  // Membership Ops — board
  { href: '/membership-ops', label: 'Membership Ops', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/applications', label: 'Applications', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/households', label: 'Households', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/volunteer-memberships', label: 'Volunteer Memberships', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/participants', label: 'Participants', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/participants/new', label: 'New Participant', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/participants/import', label: 'Import Participants', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/participants/merge', label: 'Merge Participants', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/review', label: 'Membership Review', section: 'Membership Ops', visible: BOARD },
  { href: '/membership-ops/broken', label: 'Broken Households', section: 'Membership Ops', keywords: 'lead leadless no lead unclaimed', visible: BOARD },

  // Membership Audit — board
  { href: '/membership-audit', label: 'Membership Audit', section: 'Membership Audit', visible: BOARD },
  { href: '/membership-audit/emergency-contacts', label: 'Missing Emergency Contacts', section: 'Membership Audit', visible: BOARD },
  { href: '/membership-audit/unclaimed', label: 'Unclaimed Accounts', section: 'Membership Audit', visible: BOARD },

  // Program Ops — board
  { href: '/program-ops', label: 'Program Ops', section: 'Program Ops', visible: BOARD },
  { href: '/program-ops/programs', label: 'All Programs', section: 'Program Ops', visible: BOARD },
  { href: '/program-ops/events', label: 'Events', section: 'Program Ops', visible: BOARD },
  { href: '/program-ops/new', label: 'New Program', section: 'Program Ops', visible: BOARD },
  { href: '/program-ops/sessions', label: 'Sessions', section: 'Program Ops', visible: BOARD },
  { href: '/program-ops/sessions/new', label: 'New Session', section: 'Program Ops', visible: BOARD },

  // Finance Ops — board
  { href: '/finance-ops', label: 'Finance Ops', section: 'Finance Ops', visible: BOARD },
  { href: '/finance-ops/payment-plan', label: 'Payment Plans', section: 'Finance Ops', visible: BOARD },

  // System Status — board
  { href: '/system-status', label: 'System Status', section: 'System Status', visible: BOARD },
  { href: '/system-status/health', label: 'Health', section: 'System Status', visible: BOARD },
  { href: '/system-status/errors', label: 'Errors', section: 'System Status', visible: BOARD },
  { href: '/system-status/audit-log', label: 'Audit Log', section: 'System Status', visible: BOARD },
  { href: '/system-status/links', label: 'Links', section: 'System Status', visible: BOARD },

  // Settings — board
  { href: '/settings/membership', label: 'Membership Settings', section: 'Settings', visible: BOARD },
  { href: '/settings/roles', label: 'Role Assignment', section: 'Settings', visible: BOARD },
  { href: '/settings/localization', label: 'Localization', section: 'Settings', visible: SYSADMIN },
];

// Routes that exist as page.tsx but are intentionally absent from the directory.
// Keep in sync with the drift test (pageRegistry.test.ts).
export const REGISTRY_EXCLUDED: string[] = [
  '/',                       // home/landing, reached via the brand logo
  '/index',                  // this directory page itself
  '/access-denied',          // error surface, not a destination
  '/signin',                 // auth surface
  '/settings',               // redirects to /settings/membership
  '/attendance',             // redirects to /attendance/current
];
