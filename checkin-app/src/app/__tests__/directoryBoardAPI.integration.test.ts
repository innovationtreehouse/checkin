/**
 * @jest-environment node
 */
/**
 * Regression guard for GET /api/directory/board.
 *
 * Pins the field set leaving the board directory. The endpoint must NEVER ship
 * pii (`dob`, `googleId`) regardless of caller — this is enforced twice: the
 * route's explicit Prisma `select` (defense in depth) AND the outbound stripper.
 * Reverting the `select` makes the board-member assertions fail, which is the
 * point: this test guards the leak.
 */
import { GET } from '@/app/api/directory/board/route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const TAG = 'directory-board-test';

function req() {
    return new Request('http://localhost/api/directory/board') as unknown as import('next/server').NextRequest;
}

describe('GET /api/directory/board', () => {
    let boardId: number;
    let keyholderId: number;
    const householdIds: number[] = [];

    beforeAll(async () => {
        // A board member WITH non-null pii, so "must not leak dob/googleId" is a
        // meaningful assertion (an all-null fixture would pass vacuously).
        const board = await prisma.participant.create({
            data: {
                name: `Board ${TAG}`,
                email: `board-${TAG}@example.com`,
                phone: '555-0001',
                dateOfBirth: new Date('1980-01-01'),
                googleId: `google-${TAG}`,
                boardMember: true,
                household: { create: {} },
            },
        });
        boardId = board.id;
        householdIds.push(board.householdId);

        const keyholder = await prisma.participant.create({
            data: {
                name: `Keyholder ${TAG}`,
                email: `keyholder-${TAG}@example.com`,
                keyholder: true,
                household: { create: {} },
            },
        });
        keyholderId = keyholder.id;
        householdIds.push(keyholder.householdId);
    });

    beforeEach(() => jest.clearAllMocks());

    afterAll(async () => {
        await prisma.participant.deleteMany({ where: { id: { in: [boardId, keyholderId] } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    it('a board member gets rows that never contain dob or googleId', async () => {
        mockSession.mockResolvedValue({ user: { id: boardId, boardMember: true } });

        const res = await GET(req());
        expect(res.status).toBe(200);
        const { boardMembers } = await res.json();

        expect(Array.isArray(boardMembers)).toBe(true);
        const seeded = boardMembers.find((r: { id: number }) => r.id === boardId);
        expect(seeded).toBeDefined();
        // Board legitimately sees contact fields...
        expect(seeded.email).toBe(`board-${TAG}@example.com`);
        expect(seeded.phone).toBe('555-0001');
        // ...but pii must never ship, for any row.
        for (const row of boardMembers) {
            expect(row).not.toHaveProperty('dateOfBirth');
            expect(row).not.toHaveProperty('googleId');
        }
    });

    it('a keyholder gets only public/member fields — no email/phone/dob/googleId', async () => {
        mockSession.mockResolvedValue({ user: { id: keyholderId, keyholder: true } });

        const res = await GET(req());
        expect(res.status).toBe(200);
        const { boardMembers } = await res.json();

        const seeded = boardMembers.find((r: { id: number }) => r.id === boardId);
        expect(seeded).toBeDefined();
        // Public fields survive.
        expect(seeded.name).toBe(`Board ${TAG}`);
        // Stripper clears contact pii for keyholders.
        for (const row of boardMembers) {
            expect(row).not.toHaveProperty('email');
            expect(row).not.toHaveProperty('phone');
            expect(row).not.toHaveProperty('dateOfBirth');
            expect(row).not.toHaveProperty('googleId');
        }
    });
});
