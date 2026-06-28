/**
 * @jest-environment node
 */
/**
 * Authorization-boundary tests for sensitive (PII / impersonation) routes that
 * previously had no integration coverage. Focus: who is rejected.
 *   - GET /api/admin/emergency-contacts   (sysadmin | boardMember | keyholder)
 *   - GET /api/admin/participants/search  (sysadmin | boardMember — keyholder MUST be denied)
 *   - GET /api/auth/dev-personas          (impersonation surface; 404 outside dev)
 */
import { GET as EmergencyGet } from '@/app/api/admin/emergency-contacts/route';
import { GET as SearchGet } from '@/app/api/admin/participants/search/route';
import { GET as DevPersonasGet } from '@/app/api/auth/dev-personas/route';
import { GET as KioskCertsGet } from '@/app/api/kiosk/certifications/route';
import { GET as ShopCertsGet } from '@/app/api/shop/certifications/route';
import prisma from '@/lib/prisma';

jest.mock('next-auth/next', () => ({
    getServerSession: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const TAG = 'authz-routes-test';

function req(url = 'http://localhost/') {
    return new Request(url) as unknown as import('next/server').NextRequest;
}

describe('Sensitive route authorization', () => {
    let plainId: number;
    let searchTargetId: number;
    let personaId: number;
    const householdIds: number[] = [];
    const ENV_BEFORE = process.env.CHECKIN_ENV;

    beforeAll(async () => {
        const plain = await prisma.participant.create({
            data: { name: 'Authz Plain', email: `plain-${TAG}@example.com`, household: { create: {} } },
        });
        plainId = plain.id;
        householdIds.push(plain.householdId);

        const target = await prisma.participant.create({
            data: { name: `ZZTarget ${TAG}`, email: `target-${TAG}@example.com`, phone: '555-0101', household: { create: {} } },
        });
        searchTargetId = target.id;
        householdIds.push(target.householdId);

        const persona = await prisma.participant.create({
            data: { name: 'Persona One', email: `persona-${TAG}@example.com`, sysadmin: true, household: { create: {} } },
        });
        personaId = persona.id;
        householdIds.push(persona.householdId);
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CHECKIN_ENV = 'dev';
    });

    afterAll(async () => {
        process.env.CHECKIN_ENV = ENV_BEFORE;
        await prisma.participant.deleteMany({ where: { id: { in: [plainId, searchTargetId, personaId] } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    describe('GET /api/admin/emergency-contacts', () => {
        it('401 when unauthenticated', async () => {
            mockSession.mockResolvedValue(null);
            expect((await EmergencyGet(req())).status).toBe(401);
        });

        it('403 for a user with no privileged role', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            expect((await EmergencyGet(req())).status).toBe(403);
        });

        it('200 for a keyholder (emergency access is allowed)', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, keyholder: true } });
            const res = await EmergencyGet(req());
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(Array.isArray(json.households)).toBe(true);
        });
    });

    describe('GET /api/admin/participants/search', () => {
        const url = `http://localhost/api/admin/participants/search?q=ZZTarget`;

        it('401 when unauthenticated', async () => {
            mockSession.mockResolvedValue(null);
            expect((await SearchGet(req(url))).status).toBe(401);
        });

        it('403 for a plain user', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            expect((await SearchGet(req(url))).status).toBe(403);
        });

        it('403 for a keyholder — keyholders may not search the PII directory', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, keyholder: true } });
            expect((await SearchGet(req(url))).status).toBe(403);
        });

        it('200 for a board member, returning the matched participant with PII', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, boardMember: true } });
            const res = await SearchGet(req(url));
            expect(res.status).toBe(200);
            const json = await res.json();
            const hit = json.participants.find((p: { id: number }) => p.id === searchTargetId);
            expect(hit).toBeDefined();
            expect(hit.phone).toBe('555-0101');
        });
    });

    describe('GET /api/kiosk/certifications', () => {
        const url = `http://localhost/api/kiosk/certifications?limit_to_present=false`;

        it('401 when unauthenticated (no session, no kiosk key on cloud dev)', async () => {
            mockSession.mockResolvedValue(null);
            expect((await KioskCertsGet(req(url))).status).toBe(401);
        });

        it('403 for a plain member — the roster + minor PII must not leak', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            expect((await KioskCertsGet(req(url))).status).toBe(403);
        });

        it('200 for a keyholder, returning the roster', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, keyholder: true } });
            const res = await KioskCertsGet(req(url));
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(Array.isArray(json.participants)).toBe(true);
        });
    });

    describe('GET /api/shop/certifications (per-participant IDOR)', () => {
        const otherUrl = () => `http://localhost/api/shop/certifications?participantId=${searchTargetId}`;

        it('401 when unauthenticated', async () => {
            mockSession.mockResolvedValue(null);
            expect((await ShopCertsGet(req(otherUrl()))).status).toBe(401);
        });

        it('200 for a member reading their own certs', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            const res = await ShopCertsGet(req(`http://localhost/api/shop/certifications?participantId=${plainId}`));
            expect(res.status).toBe(200);
        });

        it('403 for a member reading another participant id', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            expect((await ShopCertsGet(req(otherUrl()))).status).toBe(403);
        });

        it('200 for a board member reading any participant id', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, boardMember: true } });
            expect((await ShopCertsGet(req(otherUrl()))).status).toBe(200);
        });

        it('200 for a tool certifier (MAY_CERTIFY_OTHERS) reading any participant id', async () => {
            mockSession.mockResolvedValue({
                user: { id: plainId, toolStatuses: [{ toolId: 1, level: 'MAY_CERTIFY_OTHERS' }] },
            });
            expect((await ShopCertsGet(req(otherUrl()))).status).toBe(200);
        });

        it('200 for a sysadmin reading any participant id', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, sysadmin: true } });
            expect((await ShopCertsGet(req(otherUrl()))).status).toBe(200);
        });
    });

    describe('GET /api/auth/dev-personas', () => {
        it('404 in production (impersonation surface must be off)', async () => {
            process.env.CHECKIN_ENV = 'prod';
            mockSession.mockResolvedValue({ user: { id: personaId, sysadmin: true } });
            expect((await DevPersonasGet()).status).toBe(404);
        });

        it('404 on the cloud dev instance when unauthenticated', async () => {
            process.env.CHECKIN_ENV = 'dev';
            mockSession.mockResolvedValue(null);
            expect((await DevPersonasGet()).status).toBe(404);
        });

        it('200 with the persona list when authenticated on dev', async () => {
            process.env.CHECKIN_ENV = 'dev';
            mockSession.mockResolvedValue({ user: { id: personaId } });
            const res = await DevPersonasGet();
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.personas.some((p: { id: number }) => p.id === personaId)).toBe(true);
        });
    });
});
