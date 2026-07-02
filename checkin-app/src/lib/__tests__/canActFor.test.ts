/**
 * @jest-environment node
 *
 * Direct cover for `canActFor` in @/lib/household/activityMembers — the trust
 * boundary for cross-member reads/writes. Pins the negative cases (non-lead
 * acting for a sibling; lead acting across households) that the RSVP route test
 * only exercises indirectly.
 */

import type { Session } from 'next-auth';
import { canActFor } from '@/lib/household/activityMembers';

const mockParticipantFindMany = jest.fn();
jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: { person: { findMany: (...a: unknown[]) => mockParticipantFindMany(...a) } },
}));

const session = (u: { id: number; householdId?: number; householdLead?: boolean }) =>
    ({ user: { name: 'X', ...u } } as unknown as Session);

beforeEach(() => jest.clearAllMocks());

it('lets an actor act for themselves', async () => {
    expect(await canActFor(session({ id: 1 }), 1)).toBe(true);
    expect(mockParticipantFindMany).not.toHaveBeenCalled(); // self short-circuits, no DB read
});

it('lets a household lead act for a member of the same household', async () => {
    mockParticipantFindMany.mockResolvedValue([{ id: 1, name: 'Lead' }, { id: 2, name: 'Kid' }]);
    expect(await canActFor(session({ id: 1, householdId: 10, householdLead: true }), 2)).toBe(true);
});

it('forbids a non-lead from acting for a sibling in the same household', async () => {
    expect(await canActFor(session({ id: 1, householdId: 10, householdLead: false }), 2)).toBe(false);
    expect(mockParticipantFindMany).not.toHaveBeenCalled(); // non-lead never sees the household roster
});

it('forbids a household lead from acting across households', async () => {
    // findMany is scoped to the lead's own household; the target id is not in it.
    mockParticipantFindMany.mockResolvedValue([{ id: 1, name: 'Lead' }, { id: 2, name: 'Kid' }]);
    expect(await canActFor(session({ id: 1, householdId: 10, householdLead: true }), 99)).toBe(false);
});
