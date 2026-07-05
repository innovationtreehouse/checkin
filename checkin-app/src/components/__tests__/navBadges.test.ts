import { navBadgeFor, tabBadgeFor, reviewBadges, settingsMisconfigBadge, programsMisconfigBadge, leadsAnyProgram, leadPendingCount, leadConflictCount } from '@/components/navBadges';
import type { TodoCounts } from '@/app/api/nav/todo-counts/route';

const base: TodoCounts = {
  member: { household: [], programs: [] },
  building: 0,
  buildingHousehold: 0,
  activePrograms: 0,
};

const item = (id: number) => ({ key: `attendance-${id}`, label: `Confirm attendance for E${id}`, href: `/program-ops/sessions/${id}` });

// These tests only exercise pending-attendance counts; totalEnrolled/upcoming are filled to satisfy the type.
const prog = (id: number, name: string, pending: ReturnType<typeof item>[] = []) =>
  ({ id, name, pending, totalEnrolled: 0, upcoming: [] });

describe('staff My Programs nav gate', () => {
  it('hidden when there is no lead bucket', () => {
    expect(leadsAnyProgram(null)).toBe(false);
    expect(leadsAnyProgram(base)).toBe(false);
  });

  it('hidden when lead bucket has no programs', () => {
    expect(leadsAnyProgram({ ...base, lead: { programs: [] } })).toBe(false);
  });

  it('shown once the caller leads ≥1 program — even with zero pending items', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [prog(1, 'A')] } };
    expect(leadsAnyProgram(counts)).toBe(true);
  });
});

describe('My Programs badge count', () => {
  it('sums pending attendance across all led programs', () => {
    const counts: TodoCounts = {
      ...base,
      lead: {
        programs: [
          prog(1, 'A', [item(10), item(11)]),
          prog(2, 'B', [item(20)]),
          prog(3, 'C'),
        ],
      },
    };
    expect(leadPendingCount(counts)).toBe(3);
    const badges = navBadgeFor('/my-programs', counts);
    expect(badges).toEqual([{ count: 3, color: 'treehouseGreen', label: '3 attendance items to confirm' }]);
  });

  it('renders no badge when nothing is pending (green is action-only)', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [prog(1, 'A')] } };
    expect(navBadgeFor('/my-programs', counts)).toEqual([]);
  });

  it('singularizes the label for a single pending item', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [prog(1, 'A', [item(10)])] } };
    expect(navBadgeFor('/my-programs', counts)[0].label).toBe('1 attendance item to confirm');
  });

  it('shows a red conflict badge left of the green pending badge', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [prog(1, 'A', [item(10)])], conflicts: 2 } };
    expect(leadConflictCount(counts)).toBe(2);
    expect(navBadgeFor('/my-programs', counts)).toEqual([
      { count: 2, color: 'red', label: '2 attendance conflicts to resolve' },
      { count: 1, color: 'treehouseGreen', label: '1 attendance item to confirm' },
    ]);
  });

  it('shows only the red badge when there are conflicts but nothing pending', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [prog(1, 'A')], conflicts: 1 } };
    expect(navBadgeFor('/my-programs', counts)).toEqual([
      { count: 1, color: 'red', label: '1 attendance conflict to resolve' },
    ]);
  });
});

const admin = (over: Partial<NonNullable<TodoCounts['admin']>> = {}): TodoCounts => ({
  ...base,
  admin: {
    membership: 0,
    applicationsTotal: 0,
    paymentPlanPending: 0,
    trustedAdults: 0,
    householdsMissingContact: 0,
    unclaimedHouseholds: 0,
    brokenHouseholds: 0,
    memberFamilies: 0,
    settingsMisconfig: 0,
    programsMisconfig: 0,
    ...over,
  },
});

describe('reviewBadges (Review tab + Membership Ops nav)', () => {
  it('no badges without a review block, or when both are zero', () => {
    expect(reviewBadges(base)).toEqual([]);
    expect(reviewBadges(null)).toEqual([]);
    expect(reviewBadges({ ...base, review: { canActOn: 0, approvedAwaitingSecond: 0 } })).toEqual([]);
  });

  it('green for can-act-on, gray for approved-awaiting-second', () => {
    const counts: TodoCounts = { ...base, review: { canActOn: 3, approvedAwaitingSecond: 2 } };
    expect(reviewBadges(counts)).toEqual([
      { count: 3, color: 'treehouseGreen', label: '3 background checks you can review now' },
      { count: 2, color: 'gray', label: '2 you approved, awaiting a second reviewer' },
    ]);
  });

  it('singularizes the green label; hides each half independently at 0', () => {
    expect(reviewBadges({ ...base, review: { canActOn: 1, approvedAwaitingSecond: 0 } })).toEqual([
      { count: 1, color: 'treehouseGreen', label: '1 background check you can review now' },
    ]);
    expect(reviewBadges({ ...base, review: { canActOn: 0, approvedAwaitingSecond: 4 } })).toEqual([
      { count: 4, color: 'gray', label: '4 you approved, awaiting a second reviewer' },
    ]);
  });

  it('surfaces on the Membership Ops nav item alongside the board BLOCKED count', () => {
    const counts: TodoCounts = { ...admin({ membership: 2 }), review: { canActOn: 1, approvedAwaitingSecond: 0 } };
    expect(navBadgeFor('/membership-ops', counts)).toEqual([
      { count: 2, color: 'treehouseGreen', label: 'Pending membership reviews' },
      { count: 1, color: 'treehouseGreen', label: '1 background check you can review now' },
    ]);
  });
});

describe('settings misconfig red pill', () => {
  it('is null off the admin surface (non-board viewer)', () => {
    expect(settingsMisconfigBadge(base)).toBeNull();
    expect(settingsMisconfigBadge(null)).toBeNull();
    expect(navBadgeFor('/settings', base)).toEqual([]);
  });

  it('hidden when both settings are configured', () => {
    expect(settingsMisconfigBadge(admin({ settingsMisconfig: 0 }))).toBeNull();
    expect(navBadgeFor('/settings', admin({ settingsMisconfig: 0 }))).toEqual([]);
  });

  it('red pill with the unset count, singular label at 1', () => {
    expect(settingsMisconfigBadge(admin({ settingsMisconfig: 1 })))
      .toEqual({ count: 1, color: 'red', label: '1 required membership setting not configured' });
    expect(navBadgeFor('/settings', admin({ settingsMisconfig: 4 })))
      .toEqual([{ count: 4, color: 'red', label: '4 required membership settings not configured' }]);
  });
});

describe('programs misconfig red pill', () => {
  it('is null off the admin surface (non-board viewer)', () => {
    expect(programsMisconfigBadge(base)).toBeNull();
    expect(programsMisconfigBadge(null)).toBeNull();
  });

  it('hidden when no program is broken', () => {
    expect(programsMisconfigBadge(admin({ programsMisconfig: 0 }))).toBeNull();
  });

  it('red pill with the broken count, singular label at 1', () => {
    expect(programsMisconfigBadge(admin({ programsMisconfig: 1 })))
      .toEqual({ count: 1, color: 'red', label: '1 program with broken checkout' });
    expect(programsMisconfigBadge(admin({ programsMisconfig: 3 })))
      .toEqual({ count: 3, color: 'red', label: '3 programs with broken checkout' });
  });

  it('surfaces on the /program-ops left-nav item, empty off the admin surface', () => {
    expect(navBadgeFor('/program-ops', base)).toEqual([]);
    expect(navBadgeFor('/program-ops', admin({ programsMisconfig: 0 }))).toEqual([]);
    expect(navBadgeFor('/program-ops', admin({ programsMisconfig: 2 })))
      .toEqual([{ count: 2, color: 'red', label: '2 programs with broken checkout' }]);
  });
});

describe('tabBadgeFor', () => {
  it('returns null without an admin block (non-board viewer)', () => {
    expect(tabBadgeFor('/membership-ops/applications', base)).toBeNull();
    expect(tabBadgeFor('/safety/trusted-adults', null)).toBeNull();
  });

  it('applications tab shows every in-flight application (gray)', () => {
    expect(tabBadgeFor('/membership-ops/applications', admin({ applicationsTotal: 40 })))
      .toEqual({ count: 40, color: 'gray', label: '40 applications' });
  });

  it('broken-households tab is red (board action, blocking), the other audit tabs gray', () => {
    expect(tabBadgeFor('/membership-audit/broken', admin({ brokenHouseholds: 2 })))
      .toEqual({ count: 2, color: 'red', label: '2 households without a lead' });
    expect(tabBadgeFor('/membership-audit/emergency-contacts', admin({ householdsMissingContact: 1 })))
      .toEqual({ count: 1, color: 'gray', label: '1 household missing an emergency contact' });
    expect(tabBadgeFor('/membership-audit/unclaimed', admin({ unclaimedHouseholds: 3 })))
      .toEqual({ count: 3, color: 'gray', label: '3 unclaimed account households' });
  });

  it('trusted-adults tab matches the safety count (green)', () => {
    expect(tabBadgeFor('/safety/trusted-adults', admin({ trustedAdults: 5 })))
      .toEqual({ count: 5, color: 'treehouseGreen', label: '5 trusted-adult disclosures to review' });
  });

  it('hides action/gap tabs at zero', () => {
    expect(tabBadgeFor('/membership-ops/applications', admin())).toBeNull();
    expect(tabBadgeFor('/membership-audit/broken', admin())).toBeNull();
  });
});

// The /membership-audit section badge is a roll-up of its tabs; keep them in lockstep.
// Red section total == broken tab; gray section total == emergency + unclaimed tabs.
describe('system-status config-health badge', () => {
  it('no badge when the payload has no configHealth (non-admin) or zero issues', () => {
    expect(navBadgeFor('/system-status', base)).toEqual([]);
    expect(navBadgeFor('/system-status', { ...base, configHealth: { openIssues: 0 } })).toEqual([]);
  });

  it('red alert badge counting open config issues', () => {
    const badges = navBadgeFor('/system-status', { ...base, configHealth: { openIssues: 2 } });
    expect(badges).toEqual([{ count: 2, color: 'red', label: '2 config issues' }]);
  });

  it('singularizes the label at one issue', () => {
    const badges = navBadgeFor('/system-status', { ...base, configHealth: { openIssues: 1 } });
    expect(badges[0].label).toBe('1 config issue');
  });
});

describe('membership-audit nav ↔ tab agreement', () => {
  it('section badges equal the sum of their tab badges', () => {
    const counts = admin({ brokenHouseholds: 2, householdsMissingContact: 3, unclaimedHouseholds: 4 });
    const nav = navBadgeFor('/membership-audit', counts);
    const navRed = nav.find((b) => b.color === 'red')?.count ?? 0;
    const navGray = nav.find((b) => b.color === 'gray')?.count ?? 0;

    const broken = tabBadgeFor('/membership-audit/broken', counts)?.count ?? 0;
    const emergency = tabBadgeFor('/membership-audit/emergency-contacts', counts)?.count ?? 0;
    const unclaimed = tabBadgeFor('/membership-audit/unclaimed', counts)?.count ?? 0;

    expect(navRed).toBe(broken);
    expect(navGray).toBe(emergency + unclaimed);
  });
});
