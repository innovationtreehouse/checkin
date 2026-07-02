/**
 * @jest-environment node
 */
/**
 * Authorization-boundary tests for sensitive (PII / impersonation) routes that
 * previously had no integration coverage. Focus: who is rejected.
 *   - GET /api/safety/emergency-contacts   (isSysadmin | isBoardMember | isKeyholder)
 *   - GET /api/people/search  (isSysadmin | isBoardMember — isKeyholder MUST be denied)
 *   - GET /api/auth/dev-personas          (impersonation surface; 404 outside dev)
 */
import { GET as EmergencyGet } from '@/app/api/safety/emergency-contacts/route';
import { GET as SearchGet } from '@/app/api/people/search/route';
import { GET as DevPersonasGet } from '@/app/api/auth/dev-personas/route';
import { GET as CertsGet } from '@/app/api/kioskdisplay/certifications/route';
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
        const plain = await prisma.person.create({
            data: { name: 'Authz Plain', email: `plain-${TAG}@example.com`, household: { create: {} } },
        });
        plainId = plain.id;
        householdIds.push(plain.householdId);

        const target = await prisma.person.create({
            data: { name: `ZZTarget ${TAG}`, email: `target-${TAG}@example.com`, phone: '555-0101', household: { create: {} } },
        });
        searchTargetId = target.id;
        householdIds.push(target.householdId);

        const persona = await prisma.person.create({
            data: { name: 'Persona One', email: `persona-${TAG}@example.com`, isSysadmin: true, household: { create: {} } },
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
        await prisma.person.deleteMany({ where: { id: { in: [plainId, searchTargetId, personaId] } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    describe('GET /api/safety/emergency-contacts', () => {
        it('401 when unauthenticated', async () => {
            mockSession.mockResolvedValue(null);
            expect((await EmergencyGet(req())).status).toBe(401);
        });

        it('403 for a user with no privileged role', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            expect((await EmergencyGet(req())).status).toBe(403);
        });

        it('200 for a isKeyholder (emergency access is allowed)', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, isKeyholder: true } });
            const res = await EmergencyGet(req());
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(Array.isArray(json.households)).toBe(true);
        });
    });

    describe('GET /api/people/search', () => {
        const url = `http://localhost/api/people/search?q=ZZTarget`;

        it('401 when unauthenticated', async () => {
            mockSession.mockResolvedValue(null);
            expect((await SearchGet(req(url))).status).toBe(401);
        });

        it('403 for a plain user', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            expect((await SearchGet(req(url))).status).toBe(403);
        });

        it('403 for a isKeyholder — keyholders may not search the PII directory', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, isKeyholder: true } });
            expect((await SearchGet(req(url))).status).toBe(403);
        });

        it('200 for a board member, returning the matched participant with PII', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, isBoardMember: true } });
            const res = await SearchGet(req(url));
            expect(res.status).toBe(200);
            const json = await res.json();
            const hit = json.people.find((p: { id: number }) => p.id === searchTargetId);
            expect(hit).toBeDefined();
            expect(hit.phone).toBe('555-0101');
        });
    });

    describe('GET /api/kioskdisplay/certifications', () => {
        const url = `http://localhost/api/kioskdisplay/certifications?limit_to_present=false`;

        it('401 when unauthenticated (no session, no kiosk key on cloud dev)', async () => {
            mockSession.mockResolvedValue(null);
            expect((await CertsGet(req(url))).status).toBe(401);
        });

        it('403 for a plain member — the roster + youth PII must not leak', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId } });
            expect((await CertsGet(req(url))).status).toBe(403);
        });

        it('200 for a isKeyholder, returning the roster', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, isKeyholder: true } });
            const res = await CertsGet(req(url));
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(Array.isArray(json.participants)).toBe(true);
        });
    });

    describe('GET /api/auth/dev-personas', () => {
        it('404 in production (impersonation surface must be off)', async () => {
            process.env.CHECKIN_ENV = 'prod';
            mockSession.mockResolvedValue({ user: { id: personaId, isSysadmin: true } });
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
