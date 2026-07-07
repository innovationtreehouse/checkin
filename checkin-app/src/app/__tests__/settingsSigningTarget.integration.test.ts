/**
 * @jest-environment node
 */
/**
 * PUT /api/settings/membership — devSigningTarget (the dev-only signing radio).
 * The API must reject the field anywhere but a dev instance, and validate values,
 * so prod's BoardSettings row can never even hold a target.
 */
import { PUT } from '@/app/api/settings/membership/route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const TAG = 'signing-target-test';
const ORIGINAL_CHECKIN_ENV = process.env.CHECKIN_ENV;

describe('PUT /api/settings/membership — devSigningTarget', () => {
    let boardId: number;
    let householdId: number;
    let prevTarget: string | null = null;

    beforeAll(async () => {
        const board = await prisma.person.create({
            data: { name: 'Signing Board', email: `board-${TAG}@example.com`, household: { create: { name: 'Test HH' } } },
        });
        boardId = board.id;
        householdId = board.householdId;
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevTarget = existing?.devSigningTarget ?? null;
    });

    afterAll(async () => {
        await prisma.boardSettings.updateMany({ where: { id: 1 }, data: { devSigningTarget: prevTarget } });
        await prisma.person.deleteMany({ where: { id: boardId } });
        await prisma.household.deleteMany({ where: { id: householdId } });
        process.env.CHECKIN_ENV = ORIGINAL_CHECKIN_ENV;
    });

    // CHECKIN_ENV=local arms the keyless-kiosk fallback in authenticateRequest,
    // which hijacks any cookie-less request as `kiosk` → 403 before the role
    // gate — send a cookie so the mocked session is used.
    const put = (body: unknown) =>
        PUT(new Request('http://localhost/api/settings/membership', {
            method: 'PUT',
            headers: { cookie: 'session=test' },
            body: JSON.stringify(body),
        }) as unknown as import('next/server').NextRequest);

    it('accepts and persists the target on a dev instance', async () => {
        process.env.CHECKIN_ENV = 'dev';
        mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

        const res = await put({ devSigningTarget: 'debug' });
        expect(res.status).toBe(200);
        const row = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        expect(row?.devSigningTarget).toBe('debug');
    });

    it('rejects the field on a non-dev instance (400, nothing written)', async () => {
        process.env.CHECKIN_ENV = 'local';
        mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

        const before = (await prisma.boardSettings.findUnique({ where: { id: 1 } }))?.devSigningTarget ?? null;
        const res = await put({ devSigningTarget: 'zoho' });
        expect(res.status).toBe(400);
        expect((await res.json()).error).toMatch(/dev instance/);
        const after = (await prisma.boardSettings.findUnique({ where: { id: 1 } }))?.devSigningTarget ?? null;
        expect(after).toBe(before);
    });

    it('rejects values outside zoho/debug/null on dev', async () => {
        process.env.CHECKIN_ENV = 'dev';
        mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

        const res = await put({ devSigningTarget: 'production-zoho' });
        expect(res.status).toBe(400);
    });
});
