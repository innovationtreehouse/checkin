import { navBadgeFor, leadsAnyProgram, leadPendingCount } from '@/components/navBadges';
import type { TodoCounts } from '@/app/api/nav/todo-counts/route';

const base: TodoCounts = {
  member: { household: [], programs: [] },
  building: 0,
  buildingHousehold: 0,
  activePrograms: 0,
};

const item = (id: number) => ({ key: `attendance-${id}`, label: `Confirm attendance for E${id}`, href: `/program-ops/sessions/${id}` });

describe('staff My Programs nav gate', () => {
  it('hidden when there is no lead bucket', () => {
    expect(leadsAnyProgram(null)).toBe(false);
    expect(leadsAnyProgram(base)).toBe(false);
  });

  it('hidden when lead bucket has no programs', () => {
    expect(leadsAnyProgram({ ...base, lead: { programs: [] } })).toBe(false);
  });

  it('shown once the caller leads ≥1 program — even with zero pending items', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [{ id: 1, name: 'A', pending: [] }] } };
    expect(leadsAnyProgram(counts)).toBe(true);
  });
});

describe('My Programs badge count', () => {
  it('sums pending attendance across all led programs', () => {
    const counts: TodoCounts = {
      ...base,
      lead: {
        programs: [
          { id: 1, name: 'A', pending: [item(10), item(11)] },
          { id: 2, name: 'B', pending: [item(20)] },
          { id: 3, name: 'C', pending: [] },
        ],
      },
    };
    expect(leadPendingCount(counts)).toBe(3);
    const badges = navBadgeFor('/my-programs', counts);
    expect(badges).toEqual([{ count: 3, color: 'treehouseGreen', label: '3 attendance items to confirm' }]);
  });

  it('renders no badge when nothing is pending (green is action-only)', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [{ id: 1, name: 'A', pending: [] }] } };
    expect(navBadgeFor('/my-programs', counts)).toEqual([]);
  });

  it('singularizes the label for a single pending item', () => {
    const counts: TodoCounts = { ...base, lead: { programs: [{ id: 1, name: 'A', pending: [item(10)] }] } };
    expect(navBadgeFor('/my-programs', counts)[0].label).toBe('1 attendance item to confirm');
  });
});
