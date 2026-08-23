/**
 * @jest-environment node
 */
/**
 * Integration Tests for Individual Program API
 * Tests GET and PATCH /api/programs/[id] for viewing and updating a specific program
 */

import { GET, PATCH } from '@/app/api/programs/[id]/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';
import { ORG_DOMAIN } from '@/lib/config';
// Mock NextAuth
jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));
describe('Individual Program API Integration Tests', () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let memberId: number;
    let memberHouseholdId: number;
    let enrolledId: number;
    let parentId: number;
    let siblingId: number;
    let publicProgramId: number;
    let orgMemberOnlyProgramId: number;

    // Distinctive name we assert NEVER appears in an anonymous response — the
    // roster/association leak (#P0-5.1a) is closed iff this string is absent.
    const ENROLLED_NAME = 'Roster Leak Canary';
    const PARENT_NAME = 'Roster Parent Canary';
    const PARENT_EMAIL = 'parent-prog-id-api-test@example.com';
    const PARENT_PHONE = '5125551234';
    const SIBLING_NAME = 'Roster Sibling Canary';

    beforeAll(async () => {
        // Clean up any leaked state
        const existingUsers = await prisma.person.findMany({
            where: { email: { contains: 'prog-id-api-test' } },
            select: { id: true, householdId: true }
        });
        const existingUserIds = existingUsers.map(u => u.id);
        const existingHouseholdIds = existingUsers.map(u => u.householdId);

        await prisma.orgMembership.deleteMany({
            where: { householdId: { in: existingHouseholdIds } }
        });

        await prisma.programParticipant.deleteMany({
            where: { personId: { in: existingUserIds } }
        });
        await prisma.programVolunteer.deleteMany({
            where: { personId: { in: existingUserIds } }
        });

        await prisma.program.deleteMany({
            where: { name: { contains: 'Prog ID API Test' } }
        });
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });

        // Create Admin
        const admin = await prisma.person.create({
            data: { email: 'admin-prog-id-api-test@example.com', name: 'Admin', isSysadmin: true, household: { create: { name: "Test HH" } } }
        });
        adminId = admin.id;

        // Create Lead
        const lead = await prisma.person.create({
            data: { email: 'lead-prog-id-api-test@example.com', name: 'Lead', household: { create: { name: "Test HH" } } }
        });
        leadId = lead.id;

        // Create Common User (no membership)
        const commonUser = await prisma.person.create({
            data: { email: 'common-prog-id-api-test@example.com', name: 'Common', household: { create: { name: "Test HH" } } }
        });
        commonId = commonUser.id;

        // Create Member User (household holds an active membership)
        const memberUser = await prisma.person.create({
            data: {
                email: 'member-prog-id-api-test@example.com',
                name: 'Member',
                household: {
                    create: {
                        name: "Test HH",
                        orgMembership: {
                            create: {
                                status: 'ACTIVE',
                                memberSince: new Date()
                            }
                        }
                    }
                }
            },
            select: { id: true, householdId: true }
        });
        memberId = memberUser.id;
        memberHouseholdId = memberUser.householdId;

        // Create mock programs
        const publicProgram = await prisma.program.create({
            data: { startAt: new Date('2026-01-01'), endAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), name: 'Public Prog ID API Test', phase: 'RUNNING', orgMemberOnly: false, leadMentorId: leadId }
        });
        publicProgramId = publicProgram.id;

        const orgMemberOnlyProgram = await prisma.program.create({
            data: { startAt: new Date('2026-01-01'), endAt: new Date('2026-12-31'), name: 'Member Only Prog ID API Test', phase: 'RUNNING', orgMemberOnly: true, leadMentorId: leadId }
        });
        orgMemberOnlyProgramId = orgMemberOnlyProgram.id;

        // Enroll a participant with a recognizable name into the public program so
        // the leak tests have a roster identity to look for.
        const enrolled = await prisma.person.create({
            data: { email: 'enrolled-prog-id-api-test@example.com', name: ENROLLED_NAME, household: { create: { name: "Test HH" } } },
            select: { id: true, householdId: true }
        });
        enrolledId = enrolled.id;
        await prisma.programParticipant.create({
            data: { programId: publicProgramId, personId: enrolledId, status: 'ACTIVE' }
        });

        // The enrolled kid's parent — a lead of the same household, so the roster's
        // parent band has something to deliver.
        const parent = await prisma.person.create({
            data: {
                email: PARENT_EMAIL,
                name: PARENT_NAME,
                phone: PARENT_PHONE,
                isHouseholdLead: true,
                householdId: enrolled.householdId,
            }
        });
        parentId = parent.id;
        // A second member of the same household who is NOT a lead — the roster must
        // not list them as a parent.
        const sibling = await prisma.person.create({
            data: { email: 'sibling-prog-id-api-test@example.com', name: SIBLING_NAME, householdId: enrolled.householdId }
        });
        siblingId = sibling.id;

        // The parent also volunteers. This is the row that resolves
        // their_program_households, so a widened volunteer select would put
        // personal-tier fields on the wire here — see the narrowing pin below.
        await prisma.programVolunteer.create({
            data: { programId: publicProgramId, personId: parentId, isCore: true }
        });
    });

    afterAll(async () => {
        const existingUserIds = [adminId, leadId, commonId, memberId, enrolledId, parentId, siblingId];

        if (memberHouseholdId) {
            await prisma.orgMembership.deleteMany({
                where: { householdId: memberHouseholdId }
            });
        }

        const validProgramIds = [publicProgramId, orgMemberOnlyProgramId].filter(id => id !== undefined);
        if (validProgramIds.length > 0) {
            // ProgramParticipant/ProgramVolunteer have no cascade — clear the
            // roster rows before the program.
            await prisma.programParticipant.deleteMany({
                where: { programId: { in: validProgramIds } }
            });
            await prisma.programVolunteer.deleteMany({
                where: { programId: { in: validProgramIds } }
            });
            await prisma.program.deleteMany({
                where: { id: { in: validProgramIds } }
            });
        }
        
        await prisma.auditLog.deleteMany({
            where: { actorId: { in: existingUserIds } }
        });
        
        await prisma.person.deleteMany({
            where: { id: { in: existingUserIds } }
        });
    });

    // Helper function to mock Next.js App Router params
    const createParams = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });

    describe('GET /api/programs/[id]', () => {
        it('should allow unauthenticated users to view public programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Public Prog ID API Test');
        });

        it('should return 404 Not Found for invalid program ID', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId } });

             const req = new Request('http://localhost:4000/api/programs/999999', { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(999999) as unknown as never);
             expect(res.status).toBe(404);
        });

        it('should allow common users to view public programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Public Prog ID API Test');
             expect(data.leadMentor.id).toBe(leadId);
        });

        it('should block common users from viewing member-only programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${orgMemberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(orgMemberOnlyProgramId) as unknown as never);
             expect(res.status).toBe(403);
             
             const data = await res.json();
             expect(data.error).toMatch(/Forbidden/);
        });

        it('should allow active members to view member-only programs', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: memberId } });

             const req = new Request(`http://localhost:4000/api/programs/${orgMemberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(orgMemberOnlyProgramId) as unknown as never);
             expect(res.status).toBe(200);
             
             const data = await res.json();
             expect(data.name).toBe('Member Only Prog ID API Test');
        });

        it('should allow admins to view member-only programs without active membership', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${orgMemberOnlyProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(orgMemberOnlyProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.name).toBe('Member Only Prog ID API Test');
        });

        // ── Roster / association leak regression (auth-consistency §5.1a) ───────────
        // ProgramParticipant rows + Participant.name are tier 'public', so per-field
        // stripping cannot hide WHO is enrolled. The route gates the association:
        // anonymous/non-enrolled get metadata + counts only, never the roster.
        it('does NOT leak the participant roster to an unauthenticated caller', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             // Metadata still flows (public catalog/registration page).
             expect(data.name).toBe('Public Prog ID API Test');
             // Roster rows are absent — no participant/volunteer arrays at all.
             expect(data.participants).toBeUndefined();
             expect(data.volunteers).toBeUndefined();
             // The enrolled identity must not appear anywhere in the payload —
             // nor the parent's, who rides the same roster rows since #1400.
             expect(JSON.stringify(data)).not.toContain(ENROLLED_NAME);
             expect(JSON.stringify(data)).not.toContain(PARENT_NAME);
             expect(JSON.stringify(data)).not.toContain(PARENT_PHONE);
             // Capacity is preserved via an aggregate count, not the rows.
             expect(data._count?.participants).toBe(1);
        });

        it('does NOT leak the roster to a plain authenticated non-enrolled caller', async () => {
             // memberId is authenticated but not enrolled in / staffing this program.
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: memberId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.name).toBe('Public Prog ID API Test');
             expect(data.participants).toBeUndefined();
             expect(JSON.stringify(data)).not.toContain(ENROLLED_NAME);
             expect(JSON.stringify(data)).not.toContain(PARENT_NAME);
        });

        it('returns the roster to the program lead mentor (staff tier unchanged)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(Array.isArray(data.participants)).toBe(true);
             expect(data.participants.some((p: { personId: number }) => p.personId === enrolledId)).toBe(true);
             expect(JSON.stringify(data)).toContain(ENROLLED_NAME);
        });

        // ── Parent contact band (#1400) ────────────────────────────────────────────
        // Runs the REAL stack (handler -> registry -> scopesHeld -> stripBag), so it
        // proves the their_program_households:pii grant actually delivers, not just
        // that the select asked for it.
        it('delivers the parents (household leads only) to the program lead mentor', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             const row = data.participants.find((p: { personId: number }) => p.personId === enrolledId);
             const parents = row.person.household.householdMembers;
             // The non-lead sibling is filtered out by the select.
             expect(parents.map((m: { id: number }) => m.id)).toEqual([parentId]);
             expect(parents[0].name).toBe(PARENT_NAME);
             expect(parents[0].phone).toBe(PARENT_PHONE);
             expect(parents[0].email).toBe(PARENT_EMAIL);
             expect(JSON.stringify(data)).not.toContain(SIBLING_NAME);
        });

        it('strips the parents contact details for an enrolled non-staff caller', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: enrolledId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             const row = data.participants.find((p: { personId: number }) => p.personId === enrolledId);
             const parents = row.person.household.householdMembers;
             expect(parents[0].name).toBe(PARENT_NAME); // public tier survives
             expect(parents[0].phone).toBeUndefined();
             expect(parents[0].email).toBeUndefined();
        });

        // Regression pin for the narrowing #1425 landed. A parent-volunteer's Person
        // row resolves their_program_households, and this view holds :pii + :personal
        // on it — so only the select keeps dateOfBirth/allergies/googleId off the
        // wire. Widening either select fails here with the offending keys named.
        it('keeps the volunteer and leadMentor Person rows narrow for a parent-volunteer', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             const SELECTED = ['id', 'name', 'email'];
             const vol = data.volunteers.find((v: { personId: number }) => v.personId === parentId);
             expect(vol).toBeDefined();
             expect(Object.keys(vol.person).filter(k => !SELECTED.includes(k))).toEqual([]);
             expect(Object.keys(data.leadMentor).filter(k => !SELECTED.includes(k))).toEqual([]);
        });

        it('returns the roster to an enrolled participant (their own household)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: enrolledId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
             const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(Array.isArray(data.participants)).toBe(true);
             expect(data.participants.some((p: { personId: number }) => p.personId === enrolledId)).toBe(true);
        });
    });

    // ── ops-stg ACCESS GATE regression (the defect that killed the prior staging
    // design) ─────────────────────────────────────────────────────────────────
    // GET /api/programs/[id] is registered `authorize: 'public'` (security/registry.ts)
    // and returns real enrolled participants' names/household/emergency-contact data —
    // exactly the surface an anonymous `curl` against a copy of PRODUCTION data must
    // never reach. `authorize: 'public'` unconditionally admits every caller regardless
    // of session state, so the gate has to be enforced ahead of that check
    // (resolveAccess in security/access-resolvers.ts), not only in authenticateRequest —
    // this describe is that regression test, run against the REAL route (handler() ->
    // registry -> resolveAccess -> stripBag), not a mock of the gate.
    describe('GET /api/programs/[id] — ops-stg access gate (regression: authorize:"public" must not bypass staging)', () => {
        const CHECKIN_ENV_BEFORE = process.env.CHECKIN_ENV;

        beforeEach(() => {
            process.env.CHECKIN_ENV = 'stg';
        });

        afterAll(() => {
            if (CHECKIN_ENV_BEFORE === undefined) delete process.env.CHECKIN_ENV;
            else process.env.CHECKIN_ENV = CHECKIN_ENV_BEFORE;
        });

        it('DENIES an anonymous caller — the regression case for the defect that shipped real minors\' data to curl', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);

            expect(res.status).not.toBe(200);
            expect(res.status).toBe(401);
            // Belt-and-suspenders: even if the status assertion above were wrong, the
            // roster identity must never appear in the body.
            const text = await res.text();
            expect(text).not.toContain(ENROLLED_NAME);
        });

        it('DENIES an authenticated non-org caller with canAccessStaging unset (false)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId, hd: 'gmail.com', emailVerified: true, canAccessStaging: false } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);

            expect(res.status).toBe(401);
        });

        it('DENIES an authenticated non-org caller whose emailVerified is false, even with the right hd', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId, hd: ORG_DOMAIN, emailVerified: false } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);

            expect(res.status).toBe(401);
        });

        it('ALLOWS an authenticated non-org caller with canAccessStaging=true (the sysadmin-settable escape hatch)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId, hd: 'gmail.com', emailVerified: true, canAccessStaging: true } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);

            expect(res.status).toBe(200);
        });

        it('ALLOWS a verified org member', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId, hd: ORG_DOMAIN, emailVerified: true } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);

            expect(res.status).toBe(200);
        });

        it('is inert outside staging (CHECKIN_ENV not stg): the same anonymous request that gets denied above still succeeds', async () => {
            process.env.CHECKIN_ENV = 'prod';
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);

            expect(res.status).toBe(200);
        });
    });

    // viewerIsMember / viewerMemberPricingEligible: additive, session-only fields
    // computed AFTER the registry response (see route.ts) — membership pricing
    // applies only when the buyer's membership covers the program's whole run.
    describe('GET /api/programs/[id] — viewer membership-pricing fields', () => {
        let prevBoardSettings: { orgMembershipYearBoundary: Date | null; bgRecheckMonths: number } | null = null;
        let pastBoundaryProgramId: number;
        const DAY_MS = 24 * 60 * 60 * 1000;
        // Inside the 2-month renewal lead window relative to "now" — irrelevant
        // here (memberId's household has no renewal process, so it's never
        // "settled"), but kept consistent with the other duration tests.
        const boundary = new Date(Date.now() + 45 * DAY_MS);

        beforeAll(async () => {
            const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
            prevBoardSettings = existing
                ? { orgMembershipYearBoundary: existing.orgMembershipYearBoundary, bgRecheckMonths: existing.bgRecheckMonths }
                : null;
            await prisma.boardSettings.upsert({
                where: { id: 1 },
                create: { id: 1, orgMembershipYearBoundary: boundary, bgRecheckMonths: existing?.bgRecheckMonths ?? 12 },
                update: { orgMembershipYearBoundary: boundary },
            });

            const pastBoundaryProgram = await prisma.program.create({
                data: { startAt: new Date('2026-01-01'), name: 'Past Boundary Prog ID API Test', phase: 'UPCOMING', endAt: new Date(boundary.getTime() + 10 * DAY_MS) },
            });
            pastBoundaryProgramId = pastBoundaryProgram.id;
        });

        afterAll(async () => {
            await prisma.program.delete({ where: { id: pastBoundaryProgramId } });
            if (prevBoardSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: prevBoardSettings });
        });

        it('an unrenewed member sees viewerIsMember: true and viewerMemberPricingEligible: false for a program past their boundary', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: memberId } });

            const req = new Request(`http://localhost:4000/api/programs/${pastBoundaryProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(pastBoundaryProgramId) as unknown as never);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.viewerIsMember).toBe(true);
            expect(data.viewerMemberPricingEligible).toBe(false);
        });

        it('omits both fields for an anonymous caller', async () => {
            (getServerSession as jest.Mock).mockResolvedValue(null);

            const req = new Request(`http://localhost:4000/api/programs/${pastBoundaryProgramId}`, { method: 'GET' });
            const res = await GET(req as unknown as import("next/server").NextRequest, createParams(pastBoundaryProgramId) as unknown as never);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.viewerIsMember).toBeUndefined();
            expect(data.viewerMemberPricingEligible).toBeUndefined();
        });

        // #1397: dues paid, background check still with the board. Not a member
        // (nothing else in the app treats them as one), but priced as one and
        // admitted to members-only programs.
        describe('a household that has paid but is awaiting background clearance', () => {
            let paidPendingId: number;
            let paidPendingHouseholdId: number;

            beforeAll(async () => {
                const person = await prisma.person.create({
                    data: {
                        email: 'paid-pending-prog-id-api-test@example.com',
                        name: 'Paid Pending',
                        household: {
                            create: {
                                name: 'Test HH',
                                orgMembership: {
                                    create: {
                                        status: 'NONE',
                                        processes: { create: { kind: 'INITIAL', status: 'PENDING_BG_CLEARANCE', paidAt: new Date() } },
                                    },
                                },
                            },
                        },
                    },
                    select: { id: true, householdId: true },
                });
                paidPendingId = person.id;
                paidPendingHouseholdId = person.householdId;
            });

            afterAll(async () => {
                await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: paidPendingHouseholdId } } });
                await prisma.orgMembership.deleteMany({ where: { householdId: paidPendingHouseholdId } });
                await prisma.person.deleteMany({ where: { id: paidPendingId } });
            });

            it('gets member pricing but is NOT reported as a member', async () => {
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: paidPendingId } });

                const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
                const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
                expect(res.status).toBe(200);

                const data = await res.json();
                expect(data.viewerIsMember).toBe(false);
                expect(data.viewerMemberPricingEligible).toBe(true);
            });

            it('loses member pricing for a program running past their membership-year boundary', async () => {
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: paidPendingId } });

                const req = new Request(`http://localhost:4000/api/programs/${pastBoundaryProgramId}`, { method: 'GET' });
                const res = await GET(req as unknown as import("next/server").NextRequest, createParams(pastBoundaryProgramId) as unknown as never);
                expect(res.status).toBe(200);

                const data = await res.json();
                expect(data.viewerMemberPricingEligible).toBe(false);
            });

            it('is admitted to a members-only program', async () => {
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: paidPendingId } });

                const req = new Request(`http://localhost:4000/api/programs/${orgMemberOnlyProgramId}`, { method: 'GET' });
                const res = await GET(req as unknown as import("next/server").NextRequest, createParams(orgMemberOnlyProgramId) as unknown as never);
                expect(res.status).toBe(200);
            });

            // Must run last in this block: it moves the process off PENDING_BG_CLEARANCE.
            it('an unpaid application in review gets neither member pricing nor members-only access', async () => {
                await prisma.orgMembershipProcess.updateMany({
                    where: { orgMembership: { householdId: paidPendingHouseholdId } },
                    data: { status: 'PENDING_PAYMENT', paidAt: null },
                });
                (getServerSession as jest.Mock).mockResolvedValue({ user: { id: paidPendingId } });

                const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, { method: 'GET' });
                const res = await GET(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
                const data = await res.json();
                expect(data.viewerMemberPricingEligible).toBe(false);

                const memberOnlyReq = new Request(`http://localhost:4000/api/programs/${orgMemberOnlyProgramId}`, { method: 'GET' });
                const memberOnlyRes = await GET(memberOnlyReq as unknown as import("next/server").NextRequest, createParams(orgMemberOnlyProgramId) as unknown as never);
                expect(memberOnlyRes.status).toBe(403);
            });
        });
    });

    describe('PATCH /api/programs/[id]', () => {
        it('should return 401 Unauthorized without session', async () => {
             (getServerSession as jest.Mock).mockResolvedValue(null);

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacked' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(401);
        });

        // P1-3: bad-parse id (malformed input) returns 400, matching GET — NOT the
        // 404 reserved for a valid id with no matching row. Checked before the
        // not-found/forbidden gates, so even an admin gets 400.
        it('returns 400 for an unparseable program ID (not 404)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const badParams = { params: Promise.resolve({ id: 'abc' }) };
             const req = new Request('http://localhost:4000/api/programs/abc', {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Nope' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, badParams as unknown as never);
             expect(res.status).toBe(400);
        });

        it('should block common users from updating a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Hacked' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(403);
        });

        it('should allow the assigned lead mentor to update a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ maxParticipants: 50 })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.program.maxParticipants).toBe(50);
             // No Shopify variant on this program — capacity propagation never engages.
             expect(data.warning).toBeUndefined();
        });

        it('should allow admins to update a program', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ phase: 'FINISHED' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(200);

             const data = await res.json();
             expect(data.program.phase).toBe('FINISHED');
        });

        // Denied-household lockout (auth-consistency §5 risk #2 / GAP-1). A denied
        // lead mentor keeps `user.id`, so the leadMentorId-match gate would still
        // pass — the denied check must reject before any mutation. No write occurs.
        it('blocks a denied lead mentor from editing their own program (401, no mutation)', async () => {
             (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId, denied: true } });

             const before = await prisma.program.findUnique({ where: { id: publicProgramId } });

             const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                 method: 'PATCH',
                 body: JSON.stringify({ name: 'Denied Hack' })
             });
             const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
             expect(res.status).toBe(401);

             const after = await prisma.program.findUnique({ where: { id: publicProgramId } });
             expect(after?.name).toBe(before?.name);
             expect(after?.name).not.toBe('Denied Hack');
        });
    });

    // ── Validation guards (consolidated from the former publish/ and settings/ routes) ──
    describe('PATCH /api/programs/[id] — validation guards', () => {
        let noLeadProgramId: number;
        let noEventsProgramId: number;
        let finishedProgramId: number;
        let validPublishProgramId: number;
        let newLeadId: number;

        beforeAll(async () => {
            const newLead = await prisma.person.create({
                data: { email: 'newlead-prog-id-api-test@example.com', name: 'New Lead', isDeclaredAdult: true, household: { create: { name: "Test HH" } } }
            });
            newLeadId = newLead.id;

            const noLeadProgram = await prisma.program.create({
                data: {
                    name: 'No Lead Prog ID API Test',
                    phase: 'PLANNING',
                    startAt: new Date('2026-01-01'),
                    endAt: new Date('2026-12-31'),
                    events: { create: { name: 'No Lead Event', startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000) } }
                }
            });
            noLeadProgramId = noLeadProgram.id;

            const noEventsProgram = await prisma.program.create({
                data: { name: 'No Events Prog ID API Test', phase: 'PLANNING', startAt: new Date('2026-01-01'), endAt: new Date('2026-12-31'), leadMentorId: leadId }
            });
            noEventsProgramId = noEventsProgram.id;

            const finishedProgram = await prisma.program.create({
                data: {
                    name: 'Finished Prog ID API Test',
                    phase: 'FINISHED',
                    enrollmentStatus: 'CLOSED',
                    startAt: new Date('2026-01-01'),
                    endAt: new Date('2026-12-31'),
                    leadMentorId: leadId,
                    events: { create: { name: 'Finished Event', startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000) } }
                }
            });
            finishedProgramId = finishedProgram.id;

            const validPublishProgram = await prisma.program.create({
                data: {
                    name: 'Valid Publish Prog ID API Test',
                    phase: 'PLANNING',
                    startAt: new Date('2026-01-01'),
                    endAt: new Date('2026-12-31'),
                    leadMentorId: leadId,
                    events: { create: { name: 'Valid Publish Event', startAt: new Date(Date.now() + 86400000), endAt: new Date(Date.now() + 90000000) } }
                }
            });
            validPublishProgramId = validPublishProgram.id;
        });

        afterAll(async () => {
            const ids = [noLeadProgramId, noEventsProgramId, finishedProgramId, validPublishProgramId].filter(Boolean);
            await prisma.programParticipant.deleteMany({ where: { programId: { in: ids } } });
            await prisma.event.deleteMany({ where: { programId: { in: ids } } });
            await prisma.program.deleteMany({ where: { id: { in: ids } } });
            await prisma.auditLog.deleteMany({ where: { actorId: newLeadId } });
            await prisma.person.deleteMany({ where: { id: newLeadId } });
        });

        // ── Publish guards ──
        it('rejects publishing without a lead mentor (400)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${noLeadProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ phase: 'UPCOMING', enrollmentStatus: 'OPEN' })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(noLeadProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Cannot publish a program without a Lead Mentor assigned');
        });

        it('rejects publishing without scheduled events (400)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${noEventsProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ phase: 'UPCOMING', enrollmentStatus: 'OPEN' })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(noEventsProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toBe('Cannot publish a program without any scheduled events');
        });

        it('rejects re-publishing a FINISHED program (409) and leaves phase unchanged', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${finishedProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ phase: 'UPCOMING' })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(finishedProgramId) as unknown as never);
            expect(res.status).toBe(409);
            const data = await res.json();
            expect(data.error).toMatch(/already finished/i);

            const after = await prisma.program.findUnique({ where: { id: finishedProgramId } });
            expect(after?.phase).toBe('FINISHED');
        });

        it('allows publishing a valid program (PLANNING → UPCOMING)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

            const req = new Request(`http://localhost:4000/api/programs/${validPublishProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ phase: 'UPCOMING', enrollmentStatus: 'OPEN' })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(validPublishProgramId) as unknown as never);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.program.phase).toBe('UPCOMING');
            expect(data.program.enrollmentStatus).toBe('OPEN');
        });

        // ── maxParticipants ──
        it('rejects a negative maxParticipants (400)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ maxParticipants: -5 })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
            expect(res.status).toBe(400);
        });

        it('rejects a zero maxParticipants (400)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ maxParticipants: 0 })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
            expect(res.status).toBe(400);
        });

        it('rejects shrinking maxParticipants below current enrollment', async () => {
            await prisma.programParticipant.createMany({
                data: [
                    { programId: validPublishProgramId, personId: commonId, status: 'ACTIVE' },
                    { programId: validPublishProgramId, personId: adminId, status: 'PENDING' },
                ]
            });

            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${validPublishProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ maxParticipants: 1 })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(validPublishProgramId) as unknown as never);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error).toMatch(/current enrollment of 2/);
        });

        // ── Age range ──
        it('rejects minAge > maxAge (400)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ minAge: 30, maxAge: 10 })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
            expect(res.status).toBe(400);
        });

        // ── Enum / type validation ──
        it('rejects bad announceOnOpen / phase / enrollmentStatus with 400', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            for (const body of [
                { announceOnOpen: 'yes' },
                { phase: 'upcoming' },
                { enrollmentStatus: 'ajar' },
            ]) {
                const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                    method: 'PATCH',
                    body: JSON.stringify(body)
                });
                const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
                expect(res.status).toBe(400);
            }
        });

        // ── Lead mentor reassignment ──
        it('blocks the lead mentor from reassigning leadMentorId (403)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });

            const req = new Request(`http://localhost:4000/api/programs/${publicProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ leadMentorId: newLeadId })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(publicProgramId) as unknown as never);
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.error).toBe('Forbidden: Only administrators can reassign lead mentors');
        });

        it('allows admins to reassign leadMentorId', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${validPublishProgramId}`, {
                method: 'PATCH',
                body: JSON.stringify({ leadMentorId: newLeadId })
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(validPublishProgramId) as unknown as never);
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.program.leadMentorId).toBe(newLeadId);
        });
    });

    // Shopify is the source of truth for program capacity (product decision
    // 2026-07-06): a maxParticipants edit on a program with a Shopify variant
    // propagates as a relative inventory adjustment. Runs against the
    // CHECKIN_ENV=local mock (config.shopifyMockActive), same as
    // programSyncShopifyAPI.integration.test.ts, so no real Admin API calls happen.
    describe('PATCH /api/programs/[id] — Shopify capacity propagation', () => {
        let prevCheckinEnv: string | undefined;
        let cappedProgramId: number;
        let uncappedProgramId: number;

        beforeAll(async () => {
            prevCheckinEnv = process.env.CHECKIN_ENV;
            process.env.CHECKIN_ENV = 'local';

            const capped = await prisma.program.create({
                data: {
                    startAt: new Date('2026-01-01'),
                    endAt: new Date('2026-12-31'),
                    name: 'Prog ID API Test Shopify Capacity',
                    phase: 'RUNNING',
                    leadMentorId: leadId,
                    orgMemberPriceCents: 5000,
                    maxParticipants: 20,
                    shopifyVariantId: 'dev-mock-variant-capacity',
                },
            });
            cappedProgramId = capped.id;

            const uncapped = await prisma.program.create({
                data: {
                    startAt: new Date('2026-01-01'),
                    endAt: new Date('2026-12-31'),
                    name: 'Prog ID API Test Shopify Uncapped',
                    phase: 'RUNNING',
                    leadMentorId: leadId,
                    orgMemberPriceCents: 5000,
                    maxParticipants: null,
                    shopifyVariantId: 'dev-mock-variant-uncapped',
                },
            });
            uncappedProgramId = uncapped.id;
        });

        afterAll(async () => {
            process.env.CHECKIN_ENV = prevCheckinEnv;
            await prisma.program.deleteMany({ where: { id: { in: [cappedProgramId, uncappedProgramId] } } });
        });

        it('returns 200 with no warning when the mock adjusts inventory for a maxParticipants change', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            // A cookie header is required: CHECKIN_ENV=local (for the Shopify mock) also
            // arms the keyless-kiosk fallback in authenticateRequest, which hijacks any
            // cookie-less request as `kiosk` -> 403 before the session/role gate runs.
            const req = new Request(`http://localhost:4000/api/programs/${cappedProgramId}`, {
                method: 'PATCH',
                headers: { cookie: 'session=test' },
                body: JSON.stringify({ maxParticipants: 25 }),
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(cappedProgramId) as unknown as never);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.program.maxParticipants).toBe(25);
            expect(data.warning).toBeUndefined();
        });

        it('returns 200 with a warning transitioning capped -> uncapped (inventory not auto-adjusted)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${cappedProgramId}`, {
                method: 'PATCH',
                headers: { cookie: 'session=test' },
                body: JSON.stringify({ maxParticipants: null }),
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(cappedProgramId) as unknown as never);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.program.maxParticipants).toBeNull();
            expect(data.warning).toMatch(/capped and uncapped/i);
        });

        it('returns 200 with a warning transitioning uncapped -> capped (inventory not auto-adjusted)', async () => {
            (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });

            const req = new Request(`http://localhost:4000/api/programs/${uncappedProgramId}`, {
                method: 'PATCH',
                headers: { cookie: 'session=test' },
                body: JSON.stringify({ maxParticipants: 30 }),
            });
            const res = await PATCH(req as unknown as import("next/server").NextRequest, createParams(uncappedProgramId) as unknown as never);
            expect(res.status).toBe(200);

            const data = await res.json();
            expect(data.program.maxParticipants).toBe(30);
            expect(data.warning).toMatch(/capped and uncapped/i);
        });
    });
});
