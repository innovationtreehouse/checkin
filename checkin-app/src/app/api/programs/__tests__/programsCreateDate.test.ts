/**
 * @jest-environment node
 *
 * Verifies that POST /api/programs:
 * 1. Forwards `startAt` / `endAt` to prisma.program.create as Date objects
 *    (not null), and the response carries them back so the client can redirect.
 * 2. Anchors those date-only strings to midnight in the org timezone, so the
 *    calendar date an admin picks is the one every org-local view renders.
 */

import { POST } from '@/app/api/programs/route';
import { getServerSession } from 'next-auth/next';
import { formatDate, toDateInput } from '@/lib/time';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

jest.mock('@/lib/appSettings', () => ({
    getAppSettings: jest.fn().mockResolvedValue({ timezone: 'America/Chicago', locale: 'en-US' }),
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

describe('POST /api/programs — startAt/endAt date preservation', () => {
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
        // CDT in September, CST in December — org midnight, not midnight UTC
        expect((createArgs.data.startAt as Date).toISOString()).toBe('2024-09-01T05:00:00.000Z');
        expect((createArgs.data.endAt as Date).toISOString()).toBe('2024-12-15T06:00:00.000Z');

        // Verify the response body includes program.startAt so the client can
        // read data.program.id and redirect to the detail page
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.program).toBeDefined();
        expect(body.program.id).toBe(42);
        // startAt in the response is serialised as an ISO string by JSON.stringify
        expect(body.program.startAt).toBeTruthy();
    });

    // Invariant: the stored instant renders as the picked calendar date on the
    // Programs list and repopulates the edit form unchanged.
    it.each(['2026-01-15', '2026-03-08', '2026-09-01', '2026-11-01'])(
        'renders %s back as the same calendar date after a create round-trip',
        async (picked) => {
            mockProgramCreate.mockResolvedValue({ id: 44, name: 'Round Trip' });

            const req = new Request('http://localhost/api/programs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Round Trip',
                    leadMentorId: 7,
                    startAt: picked,
                    endAt: picked,
                    maxParticipants: 50,
                }),
            }) as unknown as import('next/server').NextRequest;

            expect((await POST(req)).status).toBe(200);

            const { data } = mockProgramCreate.mock.calls[0][0] as { data: Record<string, unknown> };
            const [y, m, d] = picked.split('-').map(Number);
            expect(formatDate(data.startAt as Date)).toBe(`${m}/${d}/${y}`);
            expect(toDateInput(data.startAt as Date)).toBe(picked);
            expect(toDateInput(data.endAt as Date)).toBe(picked);
        },
    );

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
