/**
 * @jest-environment node
 */
/**
 * Integration tests for the "new program announced" notification trigger.
 *
 * The PATCH route fires notifyNewProgramAnnounced ONLY on the transition INTO
 * (phase=UPCOMING && enrollmentStatus=OPEN) — see src/app/api/programs/[id]/route.ts.
 * These guard: it fires on the edge, does NOT re-fire while already announced,
 * and does NOT fire when only one of the two conditions flips.
 */

import { PATCH } from '@/app/api/programs/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { notifyNewProgramAnnounced } from '@/lib/notifications';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
jest.mock('@/lib/notifications', () => ({
    notifyNewProgramAnnounced: jest.fn(),
}));

const PROGRAM_NAME_TAG = 'Announce Notify Test Program';
const mockNotify = notifyNewProgramAnnounced as jest.Mock;

const patch = (id: number, body: Record<string, unknown>) =>
    PATCH(
        new Request(`http://localhost:4000/api/programs/${id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
        }) as unknown as Request,
        { params: Promise.resolve({ id: String(id) }) },
    );

describe('New-program announce notification trigger', () => {
    let adminId: number;
    let leadId: number;

    beforeAll(async () => {
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'announce-notify-test' } },
            select: { id: true },
        });
        const existingUserIds = existingUsers.map(u => u.id);
        await prisma.program.deleteMany({ where: { name: { contains: PROGRAM_NAME_TAG } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: existingUserIds } } });
        await prisma.person.deleteMany({ where: { id: { in: existingUserIds } } });

        const admin = await prisma.person.create({
            data: { email: 'admin-announce-notify-test@example.com', name: 'Admin', isSysadmin: true, household: { create: {} } },
        });
        adminId = admin.id;
        const lead = await prisma.person.create({
            data: { email: 'lead-announce-notify-test@example.com', name: 'Lead', household: { create: {} } },
        });
        leadId = lead.id;
    });

    afterAll(async () => {
        const ids = [adminId, leadId];
        await prisma.program.deleteMany({ where: { name: { contains: PROGRAM_NAME_TAG } } });
        await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
        await prisma.person.deleteMany({ where: { id: { in: ids } } });
    });

    beforeEach(() => {
        jest.clearAllMocks();
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
    });

    it('fires once when a program crosses INTO UPCOMING + OPEN', async () => {
        const name = `${PROGRAM_NAME_TAG} cross`;
        const program = await prisma.program.create({
            data: { name, leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED' },
        });

        const res = await patch(program.id, { phase: 'UPCOMING', enrollmentStatus: 'OPEN' });
        expect(res.status).toBe(200);
        expect(mockNotify).toHaveBeenCalledTimes(1);
        expect(mockNotify).toHaveBeenCalledWith(name);
    });

    it('does NOT re-fire on a later edit while already UPCOMING + OPEN', async () => {
        const name = `${PROGRAM_NAME_TAG} already`;
        const program = await prisma.program.create({
            data: { name, leadMentorId: leadId, phase: 'UPCOMING', enrollmentStatus: 'OPEN' },
        });

        const res = await patch(program.id, { name: `${name} renamed` });
        expect(res.status).toBe(200);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('does NOT fire when only phase flips to UPCOMING (enrollment still CLOSED)', async () => {
        const name = `${PROGRAM_NAME_TAG} phaseonly`;
        const program = await prisma.program.create({
            data: { name, leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED' },
        });

        const res = await patch(program.id, { phase: 'UPCOMING' });
        expect(res.status).toBe(200);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('does NOT fire when only enrollment flips to OPEN (phase still PLANNING)', async () => {
        const name = `${PROGRAM_NAME_TAG} enrollonly`;
        const program = await prisma.program.create({
            data: { name, leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED' },
        });

        const res = await patch(program.id, { enrollmentStatus: 'OPEN' });
        expect(res.status).toBe(200);
        expect(mockNotify).not.toHaveBeenCalled();
    });
});
