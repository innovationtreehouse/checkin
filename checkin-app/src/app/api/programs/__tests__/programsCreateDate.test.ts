/**
 * @jest-environment node
 *
 * Regression test for GitHub issue #154 — start date entered during program
 * creation was dropped before reaching the detail page.
 *
 * Verifies that:
 * 1. The POST /api/programs handler forwards `startAt` and `endAt` strings to
 *    prisma.program.create as Date objects (not null).
 * 2. The response body includes `program.startAt` and `program.endAt` so the
 *    client can read data.program.id and redirect correctly.
 */

import { POST } from '@/app/api/programs/route';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/shopify', () => ({
    createShopifyProgramVariants: jest.fn().mockResolvedValue(null),
}));

jest.mock('@/lib/logger', () => ({
    logBackendError: jest.fn().mockResolvedValue(undefined),
}));

const mockProgramCreate = jest.fn();
const mockAuditLogCreate = jest.fn().mockResolvedValue({});

jest.mock('@/lib/prisma', () => ({
    __esModule: true,
    default: {
        program: {
            create: (...args: unknown[]) => mockProgramCreate(...args),
        },
        auditLog: {
            create: (...args: unknown[]) => mockAuditLogCreate(...args),
        },
    },
}));

describe('POST /api/programs — startAt/endAt date preservation (issue #154)', () => {
    const adminSession = {
        user: { id: 1, isSysadmin: true },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (getServerSession as jest.Mock).mockResolvedValue(adminSession);
    });

    it('passes startAt and endAt as Date objects when both are supplied', async () => {
        const beginStr = '2024-09-01';
        const endStr = '2024-12-15';

        const createdProgram = {
            id: 42,
            name: 'Test Program',
            leadMentorId: 7,
            startAt: new Date(beginStr),
            endAt: new Date(endStr),
            orgMemberOnly: false,
            minAge: null,
            maxAge: null,
            orgMemberPriceCents: null,
            nonOrgMemberPriceCents: null,
            maxParticipants: null,
            phase: 'PLANNING',
            enrollmentStatus: 'CLOSED',
            shopifyProductId: null,
            shopifyOrgMemberVariantId: null,
            shopifyNonOrgMemberVariantId: null,
        };
        mockProgramCreate.mockResolvedValue(createdProgram);

        const req = new Request('http://localhost/api/programs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Test Program',
                leadMentorId: 7,
                startAt: beginStr,
                endAt: endStr,
                maxParticipants: 50,
            }),
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        // Verify prisma.program.create received Date objects, not strings or null
        expect(mockProgramCreate).toHaveBeenCalledTimes(1);
        const createArgs = mockProgramCreate.mock.calls[0][0] as { data: Record<string, unknown> };
        expect(createArgs.data.startAt).toBeInstanceOf(Date);
        expect(createArgs.data.endAt).toBeInstanceOf(Date);
        expect((createArgs.data.startAt as Date).toISOString()).toMatch(/^2024-09-01/);
        expect((createArgs.data.endAt as Date).toISOString()).toMatch(/^2024-12-15/);

        // Verify the response body includes program.startAt so the client can
        // read data.program.id and redirect to the detail page
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.program).toBeDefined();
        expect(body.program.id).toBe(42);
        // startAt in the response is serialised as an ISO string by JSON.stringify
        expect(body.program.startAt).toBeTruthy();
    });

    it('stores null for startAt/endAt when omitted from the request body', async () => {
        const createdProgram = {
            id: 43,
            name: 'No-Date Program',
            leadMentorId: 7,
            startAt: null,
            endAt: null,
            orgMemberOnly: false,
            minAge: null,
            maxAge: null,
            orgMemberPriceCents: null,
            nonOrgMemberPriceCents: null,
            maxParticipants: null,
            phase: 'PLANNING',
            enrollmentStatus: 'CLOSED',
            shopifyProductId: null,
            shopifyOrgMemberVariantId: null,
            shopifyNonOrgMemberVariantId: null,
        };
        mockProgramCreate.mockResolvedValue(createdProgram);

        const req = new Request('http://localhost/api/programs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'No-Date Program',
                leadMentorId: 7,
                maxParticipants: 50,
                // startAt and endAt intentionally absent — simulates form left blank
            }),
        }) as unknown as import('next/server').NextRequest;

        const res = await POST(req);
        expect(res.status).toBe(200);

        const createArgs = mockProgramCreate.mock.calls[0][0] as { data: Record<string, unknown> };
        expect(createArgs.data.startAt).toBeNull();
        expect(createArgs.data.endAt).toBeNull();
    });
});
