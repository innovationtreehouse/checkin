import { navBadgeFor, leadsAnyProgram, leadPendingCount } from '@/components/navBadges';
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
});
