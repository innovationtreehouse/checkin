// Pure nav-badge derivation, split out of AppFrame so it can be unit-tested
// without pulling in React/Mantine. AppFrame imports navBadgeFor for rendering
// and leadsAnyProgram for the staff "My Programs" visibility gate.
import type { TodoCounts } from '@/app/api/nav/todo-counts/route';

export type NavBadge = { count: number; color: string; label: string };

/** True when the caller leads ≥1 program — gates the staff "My Programs" nav item. */
export function leadsAnyProgram(counts: TodoCounts | null): boolean {
  return !!counts?.lead && counts.lead.programs.length > 0;
}

/** Total pending attendance items across the caller's led programs (green badge count). */
export function leadPendingCount(counts: TodoCounts | null): number {
  return counts?.lead?.programs.reduce((sum, p) => sum + p.pending.length, 0) ?? 0;
}

/**
 * Background-check Review badges (0, 1, or 2), shared by the left-nav Membership
 * Ops item and the Review sub-tab so both stay in lockstep: green = applications
 * this reviewer can act on now; gray = ones they approved awaiting a second
 * reviewer. Each hides at 0.
 */
export function reviewBadges(counts: TodoCounts | null): NavBadge[] {
  const r = counts?.review;
  if (!r) return [];
  const out: NavBadge[] = [];
  if (r.canActOn > 0)
    out.push({ count: r.canActOn, color: 'treehouseGreen', label: `${r.canActOn} background check${r.canActOn === 1 ? '' : 's'} you can review now` });
  if (r.approvedAwaitingSecond > 0)
    out.push({ count: r.approvedAwaitingSecond, color: 'gray', label: `${r.approvedAwaitingSecond} you approved, awaiting a second reviewer` });
  return out;
}

/**
 * Badges for a nav item (0, 1, or 2). Green = action the viewer must take, or
 * the viewer's own household; gray = live informational count (others'
 * occupancy, running programs). Attendance shows two: my household vs everyone
 * else currently in the building.
 */
export function navBadgeFor(href: string, counts: TodoCounts | null): NavBadge[] {
  if (!counts) return [];
  const green = (n: number, label: string): NavBadge[] =>
    n > 0 ? [{ count: n, color: 'treehouseGreen', label }] : [];
  const gray = (n: number, label: string): NavBadge[] =>
    n > 0 ? [{ count: n, color: 'gray', label }] : [];
  switch (href) {
    case '/my-household':
      return green(counts.member.household.length, `${counts.member.household.length} items need attention`);
    case '/my-programs': {
      // Pending attendance the lead must confirm, summed across their programs.
      const n = leadPendingCount(counts);
      return green(n, `${n} attendance ${n === 1 ? 'item' : 'items'} to confirm`);
    }
    case '/attendance': {
      const mine = counts.buildingHousehold;
      const blue = (n: number, label: string): NavBadge[] =>
        n > 0 ? [{ count: n, color: 'blue', label }] : [];
      return [
        // Blue not green: informational (who's here), not an action to take.
        ...blue(mine, `${mine} from your household currently in the building`),
        ...gray(counts.building, `${counts.building} people currently in the building`),
      ];
    }
    case '/programs':
      return gray(counts.activePrograms, `${counts.activePrograms} active programs`);
    case '/membership-ops': {
      // Board's BLOCKED queue (green) plus the viewer's own background-check
      // review counts — the Review tab lives under this nav item, so its badges
      // surface here too. Gray mirrors the Applications tab's total in-flight count.
      const apps = counts.admin ? counts.admin.applicationsTotal : 0;
      return [
        ...green(counts.admin ? counts.admin.membership : 0, 'Pending membership reviews'),
        ...gray(apps, `${apps} application${plural(apps, '', 's')}`),
        ...reviewBadges(counts),
      ];
    }
    case '/membership-audit': {
      // Green: leadless households the board must fix (assign a lead). Gray: gaps
      // the household must close — missing emergency contacts plus accounts created
      // at registration but never claimed.
      const grayTotal = counts.admin ? counts.admin.householdsMissingContact + counts.admin.unclaimedHouseholds : 0;
      return [
        ...green(counts.admin ? counts.admin.brokenHouseholds : 0, 'Leadless households needing a lead assigned'),
        ...gray(grayTotal, 'Households missing an emergency contact or with an unclaimed account'),
      ];
    }
    case '/finance-ops':
      // Pending participants awaiting payment-plan approval.
      return green(counts.admin ? counts.admin.paymentPlanPending : 0, 'Pending payment-plan approvals');
    case '/safety':
      // Trusted-adult disclosures awaiting board review.
      return green(counts.admin ? counts.admin.trustedAdults : 0, 'Trusted-adult disclosures to review');
    // System Status has no badge: every count it could show (membership,
    // payment-plan, trusted-adult) belongs to another nav item that already
    // badges it. A roll-up here just duplicates those numbers under an
    // unrelated label.
    default:
      return [];
  }
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * Badge for a section *sub-tab*, off the same shared counts. Lives here beside
 * navBadgeFor so the tab number and the section-nav number are derived from one
 * file — a new admin badge is one edit, and nav vs tab can't silently slice
 * different fields for the same thing (they used to). Returns null when the tab
 * has nothing to show. Layouts own the <Badge> JSX (variant, active-tab color
 * pins); this owns only count + intent-color + label.
 *
 * NOT covered here: informational *total* counters that show even at 0 (e.g. the
 * Manage Memberships member-family total) — those have no section-nav twin to
 * diverge from, so they stay local to their layout.
 */
export function tabBadgeFor(href: string, counts: TodoCounts | null): NavBadge | null {
  const admin = counts?.admin;
  if (!admin) return null;
  const green = (n: number, label: string): NavBadge | null =>
    n > 0 ? { count: n, color: 'treehouseGreen', label } : null;
  const gray = (n: number, label: string): NavBadge | null =>
    n > 0 ? { count: n, color: 'gray', label } : null;
  switch (href) {
    // Membership Ops. Gray, informational: every in-flight application the
    // Applications page lists (status != ACTIVE). Distinct from the /membership-ops
    // section badge, which is green board-actionable (BLOCKED) only.
    case '/membership-ops/applications':
      return gray(admin.applicationsTotal, `${admin.applicationsTotal} application${plural(admin.applicationsTotal, '', 's')}`);
    // Membership Audit — mirrors the /membership-audit section badge: broken is
    // green (board must assign a lead), the other two gray (household's own gaps).
    case '/membership-audit/emergency-contacts':
      return gray(admin.householdsMissingContact, `${admin.householdsMissingContact} household${plural(admin.householdsMissingContact, '', 's')} missing an emergency contact`);
    case '/membership-audit/broken':
      return green(admin.brokenHouseholds, `${admin.brokenHouseholds} household${plural(admin.brokenHouseholds, '', 's')} without a lead`);
    case '/membership-audit/unclaimed':
      return gray(admin.unclaimedHouseholds, `${admin.unclaimedHouseholds} unclaimed account household${plural(admin.unclaimedHouseholds, '', 's')}`);
    // Safety — same count as the /safety section badge.
    case '/safety/trusted-adults':
      return green(admin.trustedAdults, `${admin.trustedAdults} trusted-adult disclosure${plural(admin.trustedAdults, '', 's')} to review`);
    default:
      return null;
  }
}
