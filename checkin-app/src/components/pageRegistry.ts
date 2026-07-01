// Flat directory of every named (non-dynamic) app page, used by the /index
// page directory and available to any future command palette. Each entry's
// `visible` predicate mirrors the route's real gate (NAV_ITEMS[].visible +
// the section layout's useRequireRole). Over-listing here never grants access:
// every target re-enforces its own gate on arrival, so a drifted predicate at
// worst shows a link that 403s. See docs/designs/INDEX_PAGE_SCOPING.md.

import type { TodoCounts } from '@/app/api/nav/todo-counts/route';
import { leadsAnyProgram } from '@/components/navBadges';

export type RegistryUser = {
  isSysadmin?: boolean;
  isBoardMember?: boolean;
  isKeyholder?: boolean;
  householdLead?: boolean;
  toolStatuses?: Array<{ level: string }>;
};

// counts mirrors the nav: computed roles (leads ≥1 program) aren't on the
// session user, they ride in on the todo-counts payload the index already fetches.
type Visible = (user: RegistryUser | undefined, signedIn: boolean, counts: TodoCounts | null) => boolean;

const PUBLIC: Visible = () => true;
const SIGNED_IN: Visible = (_u, signedIn) => signedIn;
// Household lead only — the membership application and trusted-adult management
// belong to the lead, not every member (a youth/dependent must not see them).
const HOUSEHOLD_LEAD: Visible = (u, signedIn) => signedIn && !!u?.householdLead;
// Program lead mentors only — mirrors the staff "My Programs" nav gate.
const LEADS_PROGRAM: Visible = (_u, signedIn, counts) => signedIn && leadsAnyProgram(counts);
const BOARD: Visible = (u) => !!u?.isSysadmin || !!u?.isBoardMember;
const SYSADMIN: Visible = (u) => !!u?.isSysadmin;
const SAFETY: Visible = (u) => !!u?.isSysadmin || !!u?.isBoardMember || !!u?.isKeyholder;
const SHOP: Visible = (u) =>
  !!u?.isSysadmin ||
  !!u?.isBoardMember ||
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
  // Staff home for program lead mentors. Lead status rides in on the todo-counts
  // payload (leadsAnyProgram), matching the nav gate. Distinct from the attendee
  // "My Programs" tab above.
  { href: '/my-programs/attendance', label: 'My Programs (Staff)', section: 'Personal', keywords: 'lead mentor program staff attendance', visible: LEADS_PROGRAM },
  { href: '/my-programs/conflicts', label: 'Attendance Conflicts', section: 'Personal', keywords: 'lead mentor duplicate overlapping visit attendance', visible: LEADS_PROGRAM },
  // Stays visible to all members: also the Join/renewal entry for new applicants
  // who aren't a household lead yet (gating it on lead would break joining).
  { href: '/membership', label: 'Membership Application', section: 'Personal', keywords: 'join intake', visible: SIGNED_IN },
  { href: '/trusted-adults', label: 'Trusted Adults', section: 'Personal', visible: HOUSEHOLD_LEAD },

  // Attendance — any signed-in member
  { href: '/attendance/current', label: 'Attendance', section: 'Attendance', visible: SIGNED_IN },
  { href: '/attendance/manual', label: 'Manual Check-In', section: 'Attendance', visible: SIGNED_IN },
  { href: '/attendance/household', label: 'Household Check-ins', section: 'Attendance', keywords: 'visits history dependents', visible: SIGNED_IN },
  { href: '/attendance/certifications', label: 'Certifications', section: 'Attendance', visible: SIGNED_IN },

  // Programs — public
  { href: '/programs', label: 'Programs', section: 'Programs', visible: PUBLIC },

  // Communication — signed-in member
  { href: '/communication', label: 'Communication', section: 'Personal', keywords: 'notifications email preferences settings', visible: SIGNED_IN },

  // Safety — board or isKeyholder
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

  // Membership Audit — board
  { href: '/membership-audit', label: 'Membership Audit', section: 'Membership Audit', visible: BOARD },
  { href: '/membership-audit/emergency-contacts', label: 'Missing Emergency Contacts', section: 'Membership Audit', visible: BOARD },
  { href: '/membership-audit/unclaimed', label: 'Unclaimed Accounts', section: 'Membership Audit', visible: BOARD },
  { href: '/membership-audit/broken', label: 'Broken Households', section: 'Membership Audit', keywords: 'lead leadless no lead unclaimed', visible: BOARD },

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
  '/my-programs',            // redirects to /my-programs/attendance
];
