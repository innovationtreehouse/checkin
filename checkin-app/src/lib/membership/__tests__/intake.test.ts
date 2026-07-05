/**
 * @jest-environment node
 */
/**
 * Unit test for startIntake's race guard (M3): the check+create now runs inside
 * a transaction holding a FOR UPDATE lock on the Membership row, so a second
 * in-flight INITIAL process is never created — the tx's own re-check (via `tx`,
 * not the caller's stale pre-tx read) finds the winner and returns it. Mirrors
 * renewal's createRenewalProcess / renewalConcurrency.integration.test.ts intent,
 * but as a mocked-prisma unit test since this worktree has no DB.
 */
import { getIntakeState, startIntake, saveIntake, submitIntake, IntakeError } from '@/lib/membership/intake';
import { Prisma } from '@/generated/prisma/client';

const txMembershipProcess = { findFirst: jest.fn(), create: jest.fn() };
const txAuditLog = { create: jest.fn() };
const txQueryRaw = jest.fn();
const tx = { $queryRaw: txQueryRaw, orgMembershipProcess: txMembershipProcess, auditLog: txAuditLog };

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        person: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
        household: { update: jest.fn() },
        orgMembership: { upsert: jest.fn() },
        orgMembershipProcess: { findFirst: jest.fn(), update: jest.fn() },
        boardSettings: { findUnique: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    },
}));

jest.mock('@/lib/membership/external', () => ({ getExternalStatus: jest.fn() }));
jest.mock('@/lib/emergencyContacts/service', () => ({
    upsertPrimaryContact: jest.fn(),
    reconcileHouseholdConflicts: jest.fn(),
}));
jest.mock('@/lib/household/leads', () => {
    const actual = jest.requireActual('@/lib/household/leads');
    return { ...actual, addHouseholdLead: jest.fn() };
});
jest.mock('@/lib/membership/renewal', () => ({
    householdBgIsFresh: jest.fn(),
    nextBoundary: jest.fn(),
}));
jest.mock('@/lib/membership/review', () => ({ applyVolunteerStatus: jest.fn() }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require('@/lib/prisma').default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getExternalStatus } = require('@/lib/membership/external');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { upsertPrimaryContact, reconcileHouseholdConflicts } = require('@/lib/emergencyContacts/service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addHouseholdLead, HouseholdLeadLimitError, MAX_HOUSEHOLD_LEADS } = require('@/lib/household/leads');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { householdBgIsFresh } = require('@/lib/membership/renewal');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { applyVolunteerStatus } = require('@/lib/membership/review');

const user = {
    id: 1,
    householdId: 7,
    isSysadmin: false,
    householdLeads: [{ householdId: 7 }],
    household: { orgMembership: null },
};

beforeEach(() => {
    jest.clearAllMocks();
    prisma.person.findUnique.mockResolvedValue(user);
    prisma.orgMembership.upsert.mockResolvedValue({ id: 42, householdId: 7, status: 'NONE' });
});

describe('startIntake race guard', () => {
    it('a second in-flight INITIAL start (existing found under the lock) returns the existing process, no duplicate create', async () => {
        const existingProcess = { id: 99, orgMembershipId: 42, kind: 'INITIAL', status: 'INTAKE' };
        txMembershipProcess.findFirst.mockResolvedValue(existingProcess);

        const result = await startIntake(1);

        expect(result).toBe(existingProcess);
        // Lock taken before the in-flight check, inside the same transaction.
        expect(txQueryRaw).toHaveBeenCalledTimes(1);
        // No duplicate process/audit row created for the loser of the race.
        expect(txMembershipProcess.create).not.toHaveBeenCalled();
        expect(txAuditLog.create).not.toHaveBeenCalled();
    });

    it('no in-flight process → creates one INTAKE process + audit row inside the same transaction', async () => {
        txMembershipProcess.findFirst.mockResolvedValue(null);
        const created = { id: 100, orgMembershipId: 42, kind: 'INITIAL', status: 'INTAKE' };
        txMembershipProcess.create.mockResolvedValue(created);

        const result = await startIntake(1);

        expect(result).toBe(created);
        expect(txMembershipProcess.create).toHaveBeenCalledWith({
            data: { orgMembershipId: 42, kind: 'INITIAL', status: 'INTAKE' },
        });
        expect(txAuditLog.create).toHaveBeenCalledTimes(1);
    });

    it('not_lead: caller is not a household lead and not a sysadmin', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...user, householdLeads: [] });

        await expect(startIntake(1)).rejects.toMatchObject({ code: 'not_lead' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('already_member: household membership is already ACTIVE', async () => {
        prisma.person.findUnique.mockResolvedValue({
            ...user,
            household: { orgMembership: { status: 'ACTIVE' } },
        });

        await expect(startIntake(1)).rejects.toMatchObject({ code: 'already_member' });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('P2002 race loser: the FOR UPDATE lock lost to a pre-fix instance, winner found on re-query', async () => {
        const winner = { id: 101, orgMembershipId: 42, kind: 'INITIAL', status: 'INTAKE' };
        const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.8.0' });
        prisma.$transaction.mockRejectedValueOnce(p2002);
        prisma.orgMembershipProcess.findFirst.mockResolvedValue(winner);

        const result = await startIntake(1);

        expect(result).toBe(winner);
    });

    it('P2002 race loser: no winner found on re-query rethrows the original error', async () => {
        const p2002 = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '7.8.0' });
        prisma.$transaction.mockRejectedValueOnce(p2002);
        prisma.orgMembershipProcess.findFirst.mockResolvedValue(null);

        await expect(startIntake(1)).rejects.toBe(p2002);
    });
});

describe('getIntakeState', () => {
    it('no_household: participant not found at all', async () => {
        prisma.person.findUnique.mockResolvedValue(null);
        await expect(getIntakeState(1)).rejects.toBeInstanceOf(IntakeError);
    });

    it('household missing (hasHousehold=false) → nothing prefilled, no external lookup', async () => {
        prisma.person.findUnique.mockResolvedValue({ id: 1, householdId: null, household: null });

        const state = await getIntakeState(1);

        expect(state.hasHousehold).toBe(false);
        expect(state.membershipStatus).toBeNull();
        expect(state.process).toBeNull();
        expect(state.external).toBeNull();
        expect(getExternalStatus).not.toHaveBeenCalled();
        expect(state.prefill.household).toBeNull();
        expect(state.prefill.primaryParent).toBeNull();
        expect(state.prefill.secondaryParent).toBeNull();
        expect(state.prefill.children).toEqual([]);
    });

    it('household with an in-flight process, primary/secondary parents and a child → full prefill + external lookup', async () => {
        const dob = new Date('2000-01-01T00:00:00Z');
        prisma.person.findUnique.mockResolvedValue({
            id: 1,
            householdId: 7,
            household: {
                name: 'Test Household',
                intakeNotes: 'volunteer only, no students',
                line1: '1 Main St', line2: null, city: 'Austin', state: 'TX', postalCode: '78701',
                leads: [{ personId: 1 }, { personId: 2 }],
                householdMembers: [
                    { id: 1, name: 'Primary', email: 'p@x.com', dateOfBirth: dob, allergies: null },
                    { id: 2, name: 'Secondary', email: 's@x.com', dateOfBirth: null, allergies: 'peanuts' },
                    { id: 3, name: 'Kid', email: null, dateOfBirth: null, allergies: null },
                ],
                orgMembership: {
                    status: 'NONE',
                    processes: [
                        { id: 10, kind: 'INITIAL', status: 'ACTIVE' },
                        { id: 11, kind: 'INITIAL', status: 'INTAKE' },
                    ],
                },
                emergencyContacts: [{ name: 'Aunt', phone: '555-555-2000', email: 'a@x.com' }],
            },
        });
        getExternalStatus.mockResolvedValue({ contractSigned: false, contractStarted: false, bgConsented: false, bgCleared: false, deepLinkUrl: null });

        const state = await getIntakeState(1);

        expect(state.hasHousehold).toBe(true);
        expect(state.membershipStatus).toBe('NONE');
        // Highest-id non-ACTIVE process wins over the ACTIVE one.
        expect(state.process).toEqual({ id: 11, kind: 'INITIAL', status: 'INTAKE' });
        expect(getExternalStatus).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
        expect(state.prefill.primaryParent?.id).toBe(1);
        expect(state.prefill.primaryParent?.dob).toBe('2000-01-01');
        expect(state.prefill.secondaryParent?.id).toBe(2);
        expect(state.prefill.children).toHaveLength(1);
        expect(state.prefill.children[0].id).toBe(3);
        expect(state.prefill.household?.emergencyContactName).toBe('Aunt');
        expect(state.prefill.household?.notes).toBe('volunteer only, no students');
    });

    it('every process ACTIVE → process is null, no external lookup', async () => {
        prisma.person.findUnique.mockResolvedValue({
            id: 1,
            householdId: 7,
            household: {
                name: 'H', line1: null, line2: null, city: null, state: null, postalCode: null,
                leads: [{ personId: 1 }],
                householdMembers: [{ id: 1, name: 'P', email: null, dateOfBirth: null, allergies: null }],
                orgMembership: { status: 'ACTIVE', processes: [{ id: 5, kind: 'INITIAL', status: 'ACTIVE' }] },
                emergencyContacts: [],
            },
        });

        const state = await getIntakeState(1);

        expect(state.process).toBeNull();
        expect(getExternalStatus).not.toHaveBeenCalled();
    });
});

describe('saveIntake', () => {
    const baseUser = {
        id: 1,
        householdId: 7,
        isSysadmin: false,
        householdLeads: [{ householdId: 7 }],
        household: {
            name: 'H',
            line1: null, line2: null, city: null, state: null, postalCode: null,
            leads: [{ personId: 1 }],
            householdMembers: [{ id: 1 }, { id: 4 }],
            orgMembership: null,
            emergencyContacts: [],
        },
    };

    beforeEach(() => {
        prisma.person.findUnique.mockResolvedValue(baseUser);
        getExternalStatus.mockResolvedValue(null);
    });

    it('no_household when the caller has no participant row', async () => {
        prisma.person.findUnique.mockResolvedValue(null);
        await expect(saveIntake(1, {})).rejects.toBeInstanceOf(IntakeError);
    });

    it('not_lead when the caller is not a household lead', async () => {
        prisma.person.findUnique.mockResolvedValue({ ...baseUser, householdLeads: [] });
        await expect(saveIntake(1, {})).rejects.toMatchObject({ code: 'not_lead' });
    });

    it('normalized address data updates the household; emergency-contact fields upsert the primary contact', async () => {
        await saveIntake(1, {
            household: { line1: ' 1 Main St ', emergencyContactName: 'Aunt May', emergencyContactPhone: '555-555-2000' },
        });

        expect(prisma.household.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { line1: '1 Main St' } });
        expect(upsertPrimaryContact).toHaveBeenCalledWith(prisma, 7, {
            name: 'Aunt May',
            phone: '555-555-2000',
            email: undefined,
        });
        expect(reconcileHouseholdConflicts).toHaveBeenCalledWith(prisma, 7);
    });

    it('household notes persist as intakeNotes (trimmed; empty → null)', async () => {
        await saveIntake(1, { household: { notes: '  we volunteer only, no students  ' } });
        expect(prisma.household.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { intakeNotes: 'we volunteer only, no students' } });

        prisma.household.update.mockClear();
        await saveIntake(1, { household: { notes: '' } });
        expect(prisma.household.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { intakeNotes: null } });
    });

    it('no address keys and no emergency-contact keys → neither household.update nor upsertPrimaryContact is called', async () => {
        await saveIntake(1, { household: {} });

        expect(prisma.household.update).not.toHaveBeenCalled();
        expect(upsertPrimaryContact).not.toHaveBeenCalled();
    });

    it('updates the primary parent (the caller)', async () => {
        await saveIntake(1, { primaryParent: { name: 'New Name' } });

        expect(prisma.person.update).toHaveBeenCalledWith({
            where: { id: 1 },
            data: { name: 'New Name' },
        });
    });

    it('secondary parent already a household member → update + addLeadOrRecord', async () => {
        await saveIntake(1, { secondaryParent: { id: 4, name: 'Existing Parent' } });

        expect(prisma.person.update).toHaveBeenCalledWith({
            where: { id: 4 },
            data: { name: 'Existing Parent' },
        });
        expect(addHouseholdLead).toHaveBeenCalledWith(prisma, 7, 4);
    });

    it('secondary parent is new → create + addLeadOrRecord', async () => {
        prisma.person.create.mockResolvedValue({ id: 55 });

        await saveIntake(1, { secondaryParent: { name: 'New Parent', email: 'NEW@X.com' } });

        expect(prisma.person.create).toHaveBeenCalledWith({
            data: { householdId: 7, name: 'New Parent', email: 'new@x.com', dateOfBirth: null, isDeclaredAdult: false, allergies: null },
        });
        expect(addHouseholdLead).toHaveBeenCalledWith(prisma, 7, 55);
    });

    it('addHouseholdLead hitting the per-household cap is recorded as a rejection, not thrown', async () => {
        addHouseholdLead.mockRejectedValue(new HouseholdLeadLimitError(7));

        const result = await saveIntake(1, { secondaryParent: { id: 4, name: 'Existing Parent' } });

        expect(result.rejections).toEqual([
            {
                section: 'secondaryParent',
                code: 'lead_limit',
                message: expect.stringContaining(String(MAX_HOUSEHOLD_LEADS)),
            },
        ]);
    });

    it('child already a household member → update; a new named child → create', async () => {
        prisma.person.create.mockResolvedValue({ id: 56 });

        await saveIntake(1, {
            children: [
                { id: 4, name: 'Existing Kid' },
                { name: 'New Kid' },
            ],
        });

        expect(prisma.person.update).toHaveBeenCalledWith({
            where: { id: 4 },
            data: { name: 'Existing Kid' },
        });
        expect(prisma.person.create).toHaveBeenCalledWith({
            data: { householdId: 7, name: 'New Kid', dateOfBirth: null, allergies: null },
        });
    });
});

describe('submitIntake', () => {
    const inFlightUser = {
        id: 1,
        householdId: 7,
        isSysadmin: false,
        householdLeads: [{ householdId: 7 }],
        household: {
            id: 7,
            line1: '1 Main St',
            city: 'Austin',
            state: 'TX',
            postalCode: '78701',
            emergencyContacts: [{ conflictParticipantId: null, name: 'Aunt May', phone: '555-555-2000' }],
            householdMembers: [{ id: 1, name: 'Primary' }],
            orgMembership: { processes: [{ id: 11, orgMembershipId: 42, kind: 'INITIAL', status: 'INTAKE' }] },
        },
    };

    beforeEach(() => {
        prisma.person.findUnique.mockResolvedValue(inFlightUser);
        prisma.boardSettings.findUnique.mockResolvedValue(null);
        prisma.orgMembershipProcess.update.mockResolvedValue({ id: 11, status: 'PENDING_EXTERNAL_ACTION' });
    });

    it('no_process when there is no INTAKE-status INITIAL process', async () => {
        prisma.person.findUnique.mockResolvedValue({
            ...inFlightUser,
            household: { ...inFlightUser.household, orgMembership: { processes: [] } },
        });

        await expect(submitIntake(1)).rejects.toMatchObject({ code: 'no_process' });
    });

    it('incomplete: missing address and missing valid emergency contact are both reported', async () => {
        prisma.person.findUnique.mockResolvedValue({
            ...inFlightUser,
            household: { ...inFlightUser.household, line1: null, emergencyContacts: [] },
        });

        await expect(submitIntake(1)).rejects.toMatchObject({
            code: 'incomplete',
            fields: expect.arrayContaining(['address', 'emergencyContact']),
        });
    });

    it('complete + bgFresh=false → no bgClearedAt stamp, allowlist deferred to the external advance', async () => {
        householdBgIsFresh.mockResolvedValue(false);

        await submitIntake(1);

        expect(prisma.orgMembershipProcess.update).toHaveBeenCalledWith({
            where: { id: 11 },
            data: expect.not.objectContaining({ bgClearedAt: expect.anything() }),
        });
        expect(applyVolunteerStatus).not.toHaveBeenCalled();
    });

    it('complete + bgFresh=true → stamps bgClearedAt, advances, and matches the volunteer allowlist (#874)', async () => {
        householdBgIsFresh.mockResolvedValue(true);

        const result = await submitIntake(1);

        expect(prisma.orgMembershipProcess.update).toHaveBeenCalledWith({
            where: { id: 11 },
            data: expect.objectContaining({ status: 'PENDING_EXTERNAL_ACTION', bgClearedAt: expect.any(Date) }),
        });
        expect(prisma.auditLog.create).toHaveBeenCalled();
        // Fresh-check shortcut skips clearBackgroundCheck for the whole cycle, so
        // the designation allowlist must be matched here or never.
        expect(applyVolunteerStatus).toHaveBeenCalledWith(prisma, 42, 7, false);
        expect(result).toEqual({ id: 11, status: 'PENDING_EXTERNAL_ACTION' });
    });
});
