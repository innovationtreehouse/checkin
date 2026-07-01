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
      return [
        ...green(mine, `${mine} from your household currently in the building`),
        ...gray(counts.building, `${counts.building} people currently in the building`),
      ];
    }
    case '/programs':
      return gray(counts.activePrograms, `${counts.activePrograms} active programs`);
    case '/membership-ops':
      // Pending membership applications awaiting board review.
      return green(counts.admin ? counts.admin.membership : 0, 'Pending membership reviews');
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
      return green(counts.admin ? counts.admin.programsPending : 0, 'Pending payment-plan approvals');
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
