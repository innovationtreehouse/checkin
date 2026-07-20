/**
 * @jest-environment node
 */
/**
 * #1153 rel/1.0 mitigation: program-announce emails are disabled entirely on
 * this release line (the PATCH route's announce-edge call to
 * notifyNewProgramAnnounced was removed — see src/app/api/programs/[id]/route.ts).
 * The full fix (opt-in toggle + covered-member audience + paced fan-out) lands
 * on main and reaches this line at the next release cut.
 *
 * This suite pins the mitigation: notifyNewProgramAnnounced must never be
 * called by the PATCH route, regardless of the phase/enrollmentStatus edge
 * that used to trigger it.
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

describe('New-program announce notification — disabled on rel/1.0 (#1153 mitigation)', () => {
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
            data: { email: 'admin-announce-notify-test@example.com', name: 'Admin', isSysadmin: true, household: { create: { name: "Test HH" } } },
        });
        adminId = admin.id;
        const lead = await prisma.person.create({
            data: { email: 'lead-announce-notify-test@example.com', name: 'Lead', household: { create: { name: "Test HH" } } },
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

    it('does NOT fire when a program crosses INTO UPCOMING + OPEN (the old trigger edge)', async () => {
        const name = `${PROGRAM_NAME_TAG} cross`;
        const program = await prisma.program.create({
            data: { name, leadMentorId: leadId, phase: 'PLANNING', enrollmentStatus: 'CLOSED' },
        });

        const res = await patch(program.id, { phase: 'UPCOMING', enrollmentStatus: 'OPEN' });
        expect(res.status).toBe(200);
        expect(mockNotify).not.toHaveBeenCalled();
    });

    it('does NOT fire on a later edit while already UPCOMING + OPEN', async () => {
        const name = `${PROGRAM_NAME_TAG} already`;
        const program = await prisma.program.create({
            data: { name, leadMentorId: leadId, phase: 'UPCOMING', enrollmentStatus: 'OPEN' },
        });

        const res = await patch(program.id, { name: `${name} renamed` });
        expect(res.status).toBe(200);
        expect(mockNotify).not.toHaveBeenCalled();
    });
});
