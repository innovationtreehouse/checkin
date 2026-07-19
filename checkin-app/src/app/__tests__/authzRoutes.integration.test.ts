/**
 * @jest-environment node
 */
/**
 * Authorization-boundary tests for sensitive (PII / impersonation) routes that
 * previously had no integration coverage. Focus: who is rejected.
 *   - GET /api/safety/emergency-contacts   (isSysadmin | isBoardMember | isKeyholder)
 *   - GET /api/people/search  (isSysadmin | isBoardMember | isOperations — isKeyholder
 *     MUST be denied; an operations-only caller gets a stripped, ops-only shape)
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
            data: { name: 'Authz Plain', email: `plain-${TAG}@example.com`, household: { create: { name: "Test HH" } } },
        });
        plainId = plain.id;
        householdIds.push(plain.householdId);

        const target = await prisma.person.create({
            data: {
                name: `ZZTarget ${TAG}`, email: `target-${TAG}@example.com`, phone: '555-0101',
                lastBackgroundCheck: new Date('2026-01-01'),
                dateOfBirth: new Date('1990-05-05'),
                // intakeNotes (pii) and line1 (internal) exist on the fixture so the
                // ops-strip assertions below pin the projection instead of passing
                // vacuously on an unset column.
                household: {
                    create: {
                        name: "Test HH", intakeNotes: 'sensitive family note', line1: '1 Test St',
                        orgMembership: { create: { status: 'ACTIVE' } },
                    },
                },
            },
        });
        searchTargetId = target.id;
        householdIds.push(target.householdId);

        const persona = await prisma.person.create({
            data: { name: 'Persona One', email: `persona-${TAG}@example.com`, isSysadmin: true, household: { create: { name: "Test HH" } } },
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
        // The target's orgMembership row must go before its household (RESTRICT FK).
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: householdIds } } });
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
            expect(hit.lastBackgroundCheck).toBeTruthy();
            expect(hit.household.orgMembership).toBeTruthy();
            // dateOfBirth is role-conditional: board sees it, ops does not (below).
            expect(hit.dateOfBirth).toBeTruthy();
            // Household address/intakeNotes are NOT role-conditional — the explicit
            // projection drops them for every role, board included, because no
            // consumer of this endpoint reads them.
            expect(hit.household.intakeNotes).toBeUndefined();
            expect(hit.household.line1).toBeUndefined();
        });

        it('200 for an operations-only actor, with lastBackgroundCheck, dateOfBirth and the household address stripped', async () => {
            mockSession.mockResolvedValue({ user: { id: plainId, isOperations: true } });
            const res = await SearchGet(req(url));
            expect(res.status).toBe(200);
            const json = await res.json();
            const hit = json.people.find((p: { id: number }) => p.id === searchTargetId);
            expect(hit).toBeDefined();
            // Contact info stays — this is still the directory:
            expect(hit.phone).toBe('555-0101');
            // Membership standing stays too: every OrgMembership field is
            // @sensitivity:public, and isMember is derived from that same row.
            expect(hit.isMember).toBe(true);
            expect(hit.household.orgMembership).toBeTruthy();
            // Background-check compliance dates and date of birth do not:
            expect(hit.lastBackgroundCheck).toBeUndefined();
            expect(hit.dateOfBirth).toBeUndefined();
            expect(hit.isDeclaredAdult).toBeUndefined();
            // The household is an explicit projection, not a `...p.household` spread:
            // intakeNotes (pii, free-text hardship/medical disclosures) and the home
            // address must never ride along on a 200-hit directory search.
            expect(hit.household.intakeNotes).toBeUndefined();
            expect(hit.household.line1).toBeUndefined();
            expect(hit.household.name).toBe('Test HH');
            // household.householdMembers must NOT leak full Person rows one level down
            // (a plain `householdMembers: true` include returns every column, including
            // lastBackgroundCheck/googleId, regardless of the opsOnly strip above, which
            // only touches the top-level person) — the target is its own household's
            // sole member, and it has both fields set, so a leak would show up here.
            expect(hit.household.householdMembers[0].lastBackgroundCheck).toBeUndefined();
            expect(hit.household.householdMembers[0].googleId).toBeUndefined();
            // ...but isHouseholdLead (@sensitivity:public) MUST survive the select — the
            // participant-merge page reads it off these rows for its isLeadWithOthers guard
            // and [Lead] marker. The merge page's own tests mock the response, so this is the
            // only place that pins the contract; dropping it from the select must fail here.
            // Present for ops too (opsOnly strips only orgMembership on the household).
            expect(hit.household.householdMembers[0]).toHaveProperty('isHouseholdLead', false);
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
            expect((await DevPersonasGet(req('http://localhost/api/auth/dev-personas'))).status).toBe(404);
        });

        it('404 on the cloud dev instance when unauthenticated', async () => {
            process.env.CHECKIN_ENV = 'dev';
            mockSession.mockResolvedValue(null);
            expect((await DevPersonasGet(req('http://localhost/api/auth/dev-personas'))).status).toBe(404);
        });

        it('200 with the persona list when authenticated on dev', async () => {
            process.env.CHECKIN_ENV = 'dev';
            mockSession.mockResolvedValue({ user: { id: personaId } });
            // Search by the unique seed tag so the assertion is independent of the 50-row cap /
            // name ordering (the list now spans every participant, not just a handful).
            const res = await DevPersonasGet(
                req(`http://localhost/api/auth/dev-personas?q=persona-${TAG}`),
            );
            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.personas.some((p: { id: number }) => p.id === personaId)).toBe(true);
        });
    });
});
