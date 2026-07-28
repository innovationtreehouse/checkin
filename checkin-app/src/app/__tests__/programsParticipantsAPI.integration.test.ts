/**
 * @jest-environment node
 */
/**
 * Integration Tests for Program Participants API
 * Tests POST and DELETE /api/programs/[id]/participants for enrollments
 */

import { POST, DELETE } from '@/app/api/programs/[id]/participants/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
// Mock Notifications
jest.mock('@/lib/notifications', () => ({
    sendNotification: jest.fn()
}));

describe('Program Participants API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let otherId: number;
    let boardId: number;   // board member who leads a household
    let depId: number;     // dependent (25yo) in the board member's household

    let standardProgramId: number;
    let freeProgramId: number;
    let fullProgramId: number;
    let exactAgeProgramId: number;

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'partic-api-test' } },
            select: { id: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);

        await prisma.programParticipant.deleteMany({
            where: { personId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Partic API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.person.create({
            data: { email: 'admin-partic-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: { name: "Test HH" } } }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.person.create({
            data: { email: 'lead-partic-api-test@example.com', name: 'Lead', household: { create: { name: "Test HH" } } }
        });
        leadId = lead.id;

        // Create Common User (25 years old)
        const commonUser = await prisma.person.create({
            data: {
                email: 'common-partic-api-test@example.com',
                name: 'Common',
                dateOfBirth: new Date(Date.now() - (25 * 31556952000)),
                household: { create: { name: "Test HH" } }
            }
        });
        commonId = commonUser.id;

        // Create Other User (underage: 10 years old)
        const otherUser = await prisma.person.create({
            data: {
                email: 'other-partic-api-test@example.com',
                name: 'Other Underage',
                dateOfBirth: new Date(Date.now() - (10 * 31556952000)),
                household: { create: { name: "Test HH" } }
            }
        });
        otherId = otherUser.id;

        // Board member who leads a household containing a 25yo dependent. The
        // board flag lives on the session, not the DB row — see the mocks below.
        const boardHousehold = await prisma.household.create({ data: { name: "Test HH" } });
        const board = await prisma.person.create({
            data: { email: 'board-partic-api-test@example.com', name: 'Board Parent', householdId: boardHousehold.id }
        });
        boardId = board.id;
        const dependent = await prisma.person.create({
            data: {
                email: 'dep-partic-api-test@example.com',
                name: 'Board Dependent',
                dateOfBirth: new Date(Date.now() - (25 * 31556952000)),
                householdId: boardHousehold.id
            }
        });
        depId = dependent.id;
        await prisma.person.update({
            where: { id: boardId },
            data: { isHouseholdLead: true }
        });

        // Create mock programs
        const standardProgram = await prisma.program.create({
            data: { name: 'Standard Partic API Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', leadMentorId: leadId, orgMemberPriceCents: 1000, nonOrgMemberPriceCents: 1500 }
        });
        standardProgramId = standardProgram.id;

        const freeProgram = await prisma.program.create({
            data: { name: 'Free Partic API Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', leadMentorId: leadId, orgMemberPriceCents: null, nonOrgMemberPriceCents: null }
        });
        freeProgramId = freeProgram.id;

        // Create a capped program and pre-fill it to its capacity (1 participant)
        const fullProgram = await prisma.program.create({
            data: { 
                name: 'Full Partic API Test', 
                phase: 'RUNNING', 
                enrollmentStatus: 'OPEN',
                maxParticipants: 1,
                participants: {
                    create: { personId: otherId }
                }
            }
        });
        fullProgramId = fullProgram.id;

        const exactAgeProgram = await prisma.program.create({
            data: { name: 'Age Restricted Partic API Test', phase: 'RUNNING', enrollmentStatus: 'OPEN', minAge: 18, maxAge: 21 }
        });
        exactAgeProgramId = exactAgeProgram.id;
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, otherId, boardId, depId].filter(id => id !== undefined);
        const validProgramIds = [standardProgramId, freeProgramId, fullProgramId, exactAgeProgramId].filter(id => id !== undefined);

        if (existingUserIds.length > 0) {
            await prisma.programParticipant.deleteMany({
                where: { personId: { in: existingUserIds } }
            });
        }

        if (validProgramIds.length > 0) {
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
        
        if (existingUserIds.length > 0) {
            await prisma.auditLog.deleteMany({
                where: { actorId: { in: existingUserIds } }
            });

            await prisma.person.deleteMany({
                where: { id: { in: existingUserIds } }
            });
        }
    });

    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('POST /api/programs/[id]/participants', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(401);
        });

        it('should block a common user from enrolling someone else', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId }) // common trying to enroll other
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow a common user to self-enroll into a paid program as PENDING', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId }) // self-enrollment
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.personId).toBe(commonId);
             expect(data.enrollment.status).toBe('PENDING');
        });

        it('should allow a common user to self-enroll into a free program as ACTIVE', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${freeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId }) // self-enrollment
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(freeProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.personId).toBe(commonId);
             expect(data.enrollment.status).toBe('ACTIVE');
        });

        it('should block self-enrollment if the program is at full capacity', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(400); // 400 Bad Request
             
             const data = await res.json();
             expect(data.error).toMatch(/maximum capacity/);
             expect(data.requiresOverride).toBe(true);
        });

        it('should block self-enrollment if out of age constraints', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } }); // other is 10 years old

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
             expect(res.status).toBe(400);
             
             const data = await res.json();
             expect(data.error).toMatch(/at least 18/);
             expect(data.requiresOverride).toBe(true);
        });

        it('should allow admins to bypass age constraints using override', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId, override: true }) // ignoring age rules
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
        });

        // INTENT LOCK: a board/isSysadmin override DELIBERATELY overfills a program
        // past maxParticipants. The override is a confirmed action (the route first
        // returns requiresOverride:true) and is meant to bypass every soft limit —
        // closed enrollment, age, AND capacity. This 200 is correct, not a bug.
        // The non-override path still cannot overbook (see the 400 test above and
        // programsParticipantsConcurrency.integration.test.ts). Do not "fix" the
        // capacity bypass at route.ts enforceLimits to make this fail.
        it('should allow an admin override to enroll into a FULL program (deliberate overfill)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: adminId, override: true })
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.status).toBe('ACTIVE'); // override → confirmed/paid bypass

             // Program is now intentionally over its cap of 1.
             const enrolled = await prisma.programParticipant.count({ where: { programId: fullProgramId } });
             expect(enrolled).toBe(2);
        });

        // A board member is also a parent. Enrolling their own dependent through
        // the public program page must behave like any household lead: PENDING
        // (awaiting Shopify payment), NOT a comped/free enrollment and NOT a
        // scary "bypasses all payment" override prompt.
        it('should make a board parent PAY (PENDING) when enrolling their own dependent in a paid program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: depId }) // no override
             });
             const res = await POST(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             expect(data.enrollment.status).toBe('PENDING'); // pays like any parent
        });

        // The comp still belongs to genuine admin action: a board member
        // enrolling someone OUTSIDE their household (the program-ops surface).
        it('should require override + comp (ACTIVE) when a board member enrolls a non-household participant', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });

             const promptReq = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId }) // not in board's household, no override
             });
             const promptRes = await POST(promptReq as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(promptRes.status).toBe(400);
             expect((await promptRes.json()).requiresOverride).toBe(true);

             const forceReq = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'POST',
                 body: JSON.stringify({ participantId: otherId, override: true })
             });
             const forceRes = await POST(forceReq as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(forceRes.status).toBe(200);
             expect((await forceRes.json()).enrollment.status).toBe('ACTIVE'); // admin comp
        });

        // A board/sysadmin comp seats a participant with NO Shopify
        // checkout, so unlike a paid PENDING enrollment nothing ever fires
        // Shopify's own sale-time -1. The comp path must reconcile it (-1),
        // exactly like a paid sale and like scholarship apply — else the
        // storefront keeps showing the taken seat as available (oversell).
        it('comp-add decrements Shopify inventory (-1) for a capped Shopify program', async () => {
            const prevCheckinEnv = process.env.CHECKIN_ENV;
            process.env.CHECKIN_ENV = 'local'; // arms the adjustProgramInventory mock (logs the delta)
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            const shopifyProgram = await prisma.program.create({
                data: { name: 'Comp Shopify Partic API Test', enrollmentStatus: 'OPEN', maxParticipants: 5, orgMemberPriceCents: 1000, shopifyVariantId: 'dev-mock-variant-comp-partic' },
            });
            try {
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
                const res = await POST(
                    // CHECKIN_ENV=local arms the keyless-kiosk fallback — send a cookie so
                    // the request isn't hijacked as `kiosk` before the session gate runs.
                    new Request(`http://localhost:4000/api/programs/${shopifyProgram.id}/participants`, {
                        method: 'POST',
                        headers: { cookie: 'session=test' },
                        body: JSON.stringify({ participantId: otherId, override: true }), // external admin comp
                    }) as unknown as import("next/server").NextRequest,
                    createParams(shopifyProgram.id) as unknown as never,
                );
                expect(res.status).toBe(200);
                const data = await res.json();
                expect(data.enrollment.status).toBe('ACTIVE'); // comp
                expect(data.warning).toBeUndefined();
                // The comp took a seat out of the Shopify pool: relative -1 on the variant.
                expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Would adjust inventory by -1 for variants: dev-mock-variant-comp-partic'));
                // Comp is ACTIVE and NOT a hold: I1/I2/I3 keep inventoryHeldAt PENDING-only.
                const row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: otherId } },
                });
                expect(row?.inventoryHeldAt).toBeNull();
            } finally {
                logSpy.mockRestore();
                process.env.CHECKIN_ENV = prevCheckinEnv;
                await prisma.programParticipant.deleteMany({ where: { programId: shopifyProgram.id } });
                await prisma.program.delete({ where: { id: shopifyProgram.id } });
            }
        });

        // Mirror the scholarship / cap-edit Shopify-failure discipline: the DB
        // change stands, the failure is surfaced as a warning (adjustProgramInventory
        // has already logged + emailed sysadmins), and the board reconciles. A comp
        // that half-commits (enrollment rolled back) would be worse than the original gap.
        //
        // Real failure, no mock: with the Shopify mock OFF (env not `local`) and no
        // SHOPIFY_STORE_DOMAIN/credentials configured, adjustProgramInventory returns
        // false at its credential guard (before any network) — the exact non-fatal
        // failure the warning branch handles.
        it('comp-add keeps the enrollment and warns when the Shopify decrement fails', async () => {
            const prevCheckinEnv = process.env.CHECKIN_ENV;
            const prevDomain = process.env.SHOPIFY_STORE_DOMAIN;
            delete process.env.CHECKIN_ENV;       // mock off → real adjust path
            delete process.env.SHOPIFY_STORE_DOMAIN; // no creds → returns false (no network)
            const shopifyProgram = await prisma.program.create({
                data: { name: 'Comp Shopify Fail Partic API Test', enrollmentStatus: 'OPEN', maxParticipants: 5, orgMemberPriceCents: 1000, shopifyVariantId: 'dev-mock-variant-comp-fail' },
            });
            try {
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
                const res = await POST(
                    new Request(`http://localhost:4000/api/programs/${shopifyProgram.id}/participants`, {
                        method: 'POST',
                        body: JSON.stringify({ participantId: otherId, override: true }),
                    }) as unknown as import("next/server").NextRequest,
                    createParams(shopifyProgram.id) as unknown as never,
                );
                expect(res.status).toBe(200);
                expect((await res.json()).warning).toMatch(/out of sync/i);
                // No half-commit: the comp enrollment still exists (ACTIVE).
                const row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: otherId } },
                });
                expect(row?.status).toBe('ACTIVE');
            } finally {
                process.env.CHECKIN_ENV = prevCheckinEnv;
                if (prevDomain === undefined) delete process.env.SHOPIFY_STORE_DOMAIN;
                else process.env.SHOPIFY_STORE_DOMAIN = prevDomain;
                await prisma.programParticipant.deleteMany({ where: { programId: shopifyProgram.id } });
                await prisma.program.delete({ where: { id: shopifyProgram.id } });
            }
        });

        it('should return 409 (not 500) when enrolling the same participant twice', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const enroll = () => POST(
                 new Request(`http://localhost:4000/api/programs/${freeProgramId}/participants`, {
                     method: 'POST',
                     body: JSON.stringify({ participantId: leadId }) // self-enroll into free program
                 }) as unknown as import("next/server").NextRequest,
                 createParams(freeProgramId) as unknown as never
             );

             const first = await enroll();
             expect(first.status).toBe(200);

             // Double-submit (UI double-click) — must be a clean 409, not a 500.
             const second = await enroll();
             expect(second.status).toBe(409);
             const data = await second.json();
             expect(data.error).toMatch(/already enrolled/i);

             // No duplicate row, no corruption: exactly one enrollment exists.
             const count = await prisma.programParticipant.count({
                 where: { programId: freeProgramId, personId: leadId }
             });
             expect(count).toBe(1);
        });
    });

    describe('DELETE /api/programs/[id]/participants', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: commonId })
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(401);
        });

        it('should block a common user from un-enrolling someone else', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${exactAgeProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(exactAgeProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow the program lead to un-enroll a participant', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${standardProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: commonId }) // assigned lead removing common from standardProgram
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(standardProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
             // The response must NOT echo the deleted row: it reaches the lead
             // mentor and carries confidential hardship fields (see #930 review).
             expect(data.enrollment).toBeUndefined();
             const row = await prisma.programParticipant.findUnique({
                 where: { programId_personId: { programId: standardProgramId, personId: commonId } },
             });
             expect(row).toBeNull();
        });
        
        it('should allow a common user to drop out of their own program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } });

             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId }) // self-removal
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.success).toBe(true);
        });

        it('should be idempotent (200, not 500) when un-enrolling a participant twice', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: otherId } });

             // otherId already self-removed from fullProgram in the test above.
             // A second delete hits a missing row (Prisma P2025) — must stay 200.
             const req = new Request(`http://localhost:4000/api/programs/${fullProgramId}/participants`, {
                 method: 'DELETE',
                 body: JSON.stringify({ participantId: otherId })
             });
             const res = await DELETE(req as unknown as import("next/server").NextRequest, createParams(fullProgramId) as unknown as never);
             expect(res.status).toBe(200);
             const data = await res.json();
             expect(data.success).toBe(true);
        });

        // Hold-ledger (product decision 2026-07-06): withdrawal is release path
        // (a) — a denied applicant who withdraws instead of paying gets their
        // held seat back, exactly once (double-withdraw is the existing
        // idempotent no-op above, and must not fire a second +1).
        it('releases a held scholarship seat back to Shopify (+1) on withdrawal, exactly once', async () => {
            const prevCheckinEnv = process.env.CHECKIN_ENV;
            process.env.CHECKIN_ENV = 'local';
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            const shopifyProgram = await prisma.program.create({
                data: { name: 'Withdraw Shopify Partic API Test', enrollmentStatus: 'OPEN', shopifyVariantId: 'dev-mock-variant-withdraw-partic' },
            });
            try {
                await prisma.programParticipant.create({
                    data: {
                        programId: shopifyProgram.id,
                        personId: commonId,
                        status: 'PENDING',
                        isPaymentPlanRequested: false,
                        inventoryHeldAt: new Date(),
                        paymentPlanDeniedAt: new Date(),
                    },
                });
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } }); // self-withdraw

                const res = await DELETE(
                    // CHECKIN_ENV=local arms the keyless-kiosk fallback in
                    // authenticateRequest, which hijacks any cookie-less request as
                    // `kiosk` -> 403 before the session/role gate runs — send a cookie.
                    new Request(`http://localhost:4000/api/programs/${shopifyProgram.id}/participants`, {
                        method: 'DELETE',
                        headers: { cookie: 'session=test' },
                        body: JSON.stringify({ participantId: commonId }),
                    }) as unknown as import("next/server").NextRequest,
                    createParams(shopifyProgram.id) as unknown as never,
                );
                expect(res.status).toBe(200);
                expect((await res.json()).warning).toBeUndefined();
                expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Would adjust inventory by 1 for variants: dev-mock-variant-withdraw-partic'));

                const row = await prisma.programParticipant.findUnique({
                    where: { programId_personId: { programId: shopifyProgram.id, personId: commonId } },
                });
                expect(row).toBeNull();

                // Double-withdraw: idempotent 200 (P2025), no second +1.
                logSpy.mockClear();
                const second = await DELETE(
                    // CHECKIN_ENV=local arms the keyless-kiosk fallback in
                    // authenticateRequest, which hijacks any cookie-less request as
                    // `kiosk` -> 403 before the session/role gate runs — send a cookie.
                    new Request(`http://localhost:4000/api/programs/${shopifyProgram.id}/participants`, {
                        method: 'DELETE',
                        headers: { cookie: 'session=test' },
                        body: JSON.stringify({ participantId: commonId }),
                    }) as unknown as import("next/server").NextRequest,
                    createParams(shopifyProgram.id) as unknown as never,
                );
                expect(second.status).toBe(200);
                expect((await second.json()).idempotent).toBe(true);
                expect(logSpy).not.toHaveBeenCalled();
            } finally {
                logSpy.mockRestore();
                process.env.CHECKIN_ENV = prevCheckinEnv;
                await prisma.programParticipant.deleteMany({ where: { programId: shopifyProgram.id } });
                await prisma.program.delete({ where: { id: shopifyProgram.id } });
            }
        });
    });
});
