/**
 * @jest-environment node
 */
/**
 * Integration coverage for household soft-archive (docs/designs/HOUSEHOLD_ARCHIVE.md):
 * archive → hidden-from-list → blocked-enrollment → blocked-intake → un-archive-restores,
 * plus the representative cron-skip (the renewal sweep ignores archived households).
 * Real DB; auth mocked; email/notification side effects stubbed.
 */
import { GET as householdsGET, POST as householdsPOST } from '@/app/api/membership-ops/households/route';
import { POST as enrollPOST } from '@/app/api/programs/[id]/participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { runRenewalSweep } from '@/lib/membership/renewal';
import { startIntake, IntakeError } from '@/lib/membership/intake';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/notifications', () => ({ sendNotification: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/emailRecipients', () => ({
    emailHouseholdLeads: jest.fn().mockResolvedValue(undefined),
    emailBoardMembers: jest.fn().mockResolvedValue(undefined),
}));

const TAG = 'hh-archive-test';
const asAdmin = (id: number) =>
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: true, isBoardMember: false, householdId: 0 } });
const asUser = (id: number, householdId: number) =>
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, isSysadmin: false, isBoardMember: false, householdId } });

function req(body?: unknown, url = 'http://localhost/api/membership-ops/households') {
    return new Request(url, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }) as unknown as import('next/server').NextRequest;
}

describe('Household archive — integration', () => {
    let adminId: number;
    let archLeadId: number;
    let archHouseholdId: number;
    let activeHouseholdId: number;
    let programId: number;

    beforeAll(async () => {
        const admin = await prisma.person.create({
            data: { name: 'Admin', email: `admin-${TAG}@example.com`, isSysadmin: true, household: { create: { name: `Admin HH ${TAG}` } } },
        });
        adminId = admin.id;

        const archLead = await prisma.person.create({
            data: {
                name: 'Arch Lead', email: `arch-lead-${TAG}@example.com`, isHouseholdLead: true,
                dateOfBirth: new Date('1990-01-01'),
                household: { create: { name: `Archive HH ${TAG}` } },
            },
        });
        archLeadId = archLead.id;
        archHouseholdId = archLead.householdId;
        await prisma.orgMembership.create({ data: { householdId: archHouseholdId, status: 'ACTIVE' } });

        const activeLead = await prisma.person.create({
            data: {
                name: 'Active Lead', email: `active-lead-${TAG}@example.com`, isHouseholdLead: true,
                dateOfBirth: new Date('1990-01-01'),
                household: { create: { name: `Active HH ${TAG}` } },
            },
        });
        activeHouseholdId = activeLead.householdId;
        await prisma.orgMembership.create({ data: { householdId: activeHouseholdId, status: 'ACTIVE' } });

        const program = await prisma.program.create({
            data: { name: `Program ${TAG}`, enrollmentStatus: 'OPEN', orgMemberPriceCents: null, nonOrgMemberPriceCents: null },
        });
        programId = program.id;
    });

    afterAll(async () => {
        const hhIds = [archHouseholdId, activeHouseholdId];
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: hhIds } } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: hhIds } } });
        await prisma.auditLog.deleteMany({ where: { tableName: 'Household', affectedEntityId: { in: hhIds } } });
        await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
        await prisma.boardSettings.deleteMany({ where: { id: 1 } });
        await prisma.household.deleteMany({ where: { name: { contains: TAG } } });
    });

    it('POST { archive:true } stamps archivedAt and writes an audit row', async () => {
        asAdmin(adminId);
        const res = await householdsPOST(req({ householdId: archHouseholdId, archive: true }));
        expect(res.status).toBe(200);

        const hh = await prisma.household.findUnique({ where: { id: archHouseholdId } });
        expect(hh?.archivedAt).toBeInstanceOf(Date);

        const audit = await prisma.auditLog.findFirst({
            where: { tableName: 'Household', affectedEntityId: archHouseholdId, actorId: adminId },
            orderBy: { id: 'desc' },
        });
        expect(audit).not.toBeNull();
        expect((audit!.newData as { archivedAt: string | null }).archivedAt).not.toBeNull();

        // Idempotent: re-archiving an already-archived household is a no-op (no second audit row).
        const auditCountBefore = await prisma.auditLog.count({ where: { tableName: 'Household', affectedEntityId: archHouseholdId } });
        const again = await householdsPOST(req({ householdId: archHouseholdId, archive: true }));
        expect(again.status).toBe(200);
        const auditCountAfter = await prisma.auditLog.count({ where: { tableName: 'Household', affectedEntityId: archHouseholdId } });
        expect(auditCountAfter).toBe(auditCountBefore);
    });

    it('hides the archived household from the default list, shows it with includeArchived=1', async () => {
        asAdmin(adminId);

        const defaultRes = await householdsGET(req());
        const defaultIds = (await defaultRes.json()).households.map((h: { id: number }) => h.id);
        expect(defaultIds).not.toContain(archHouseholdId);
        expect(defaultIds).toContain(activeHouseholdId);

        const inclRes = await householdsGET(req(undefined, 'http://localhost/api/membership-ops/households?includeArchived=1'));
        const inclIds = (await inclRes.json()).households.map((h: { id: number }) => h.id);
        expect(inclIds).toContain(archHouseholdId);
    });

    it('blocks enrollment for a member of an archived household (409)', async () => {
        asUser(archLeadId, archHouseholdId);
        const res = await enrollPOST(
            req({ participantId: archLeadId }, `http://localhost/api/programs/${programId}/participants`),
            { params: Promise.resolve({ id: String(programId) }) },
        );
        expect(res.status).toBe(409);
        const count = await prisma.programParticipant.count({ where: { programId, personId: archLeadId } });
        expect(count).toBe(0);
    });

    it('blocks starting a membership application for an archived household', async () => {
        const err = await startIntake(archLeadId).then(() => null, (e) => e);
        expect(err).toBeInstanceOf(IntakeError);
        expect(err.code).toBe('archived');
    });

    it('renewal sweep skips the archived household but opens for the active one', async () => {
        // Boundary ~30 days out so the 2-month renewal window is open now.
        const boundary = new Date();
        boundary.setUTCDate(boundary.getUTCDate() + 30);
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, orgMembershipYearBoundary: boundary },
            update: { orgMembershipYearBoundary: boundary },
        });

        await runRenewalSweep(new Date());

        const archProc = await prisma.orgMembershipProcess.findFirst({
            where: { kind: 'RENEWAL', orgMembership: { householdId: archHouseholdId } },
        });
        const activeProc = await prisma.orgMembershipProcess.findFirst({
            where: { kind: 'RENEWAL', orgMembership: { householdId: activeHouseholdId } },
        });
        expect(archProc).toBeNull();
        expect(activeProc).not.toBeNull();
    });

    it('un-archive clears archivedAt (+ audit) and restores enrollment', async () => {
        asAdmin(adminId);
        const res = await householdsPOST(req({ householdId: archHouseholdId, archive: false }));
        expect(res.status).toBe(200);

        const hh = await prisma.household.findUnique({ where: { id: archHouseholdId } });
        expect(hh?.archivedAt).toBeNull();

        const audit = await prisma.auditLog.findFirst({
            where: { tableName: 'Household', affectedEntityId: archHouseholdId, actorId: adminId },
            orderBy: { id: 'desc' },
        });
        expect((audit!.newData as { archivedAt: string | null }).archivedAt).toBeNull();

        // Enrollment now succeeds — the un-archive fully restored activity.
        asUser(archLeadId, archHouseholdId);
        const enrollRes = await enrollPOST(
            req({ participantId: archLeadId }, `http://localhost/api/programs/${programId}/participants`),
            { params: Promise.resolve({ id: String(programId) }) },
        );
        expect(enrollRes.status).toBe(200);
        const count = await prisma.programParticipant.count({ where: { programId, personId: archLeadId } });
        expect(count).toBe(1);
    });
});
