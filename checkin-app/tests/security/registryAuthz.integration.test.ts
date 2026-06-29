/**
 * @jest-environment node
 *
 * Admission-gate (authorize) boundary tests for EVERY registry route.
 *
 * The generic policy.contract test only checks field-stripping for ALLOWED
 * personas — it early-returns on any status >= 400, so nothing there asserts
 * that an anonymous or under-privileged caller is actually REJECTED by the
 * registry-gated routes. This file closes that hole: for each route it drives
 * the REAL handler and asserts the admission gate.
 *
 *   - unauthenticated caller                       -> 401 (gated routes)
 *   - authenticated caller with NONE of the roles  -> 403 (role-gated routes)
 *   - an allowed caller                            -> 2xx (sanity)
 *
 * Table-driven off the live registry: adding a route to registry.ts adds a row
 * here automatically, and the required roles are pulled from the route's
 * `authorize` spec rather than hardcoded. If a route fails to reject an
 * under-privileged caller, the 403 assertion below fails loudly — that is a
 * live authz hole, not a test bug.
 */
// jest.setup.js installs a global @/lib/prisma mock that rejects all calls;
// this is an integration test that needs the real client to seed personas.
jest.unmock('@/lib/prisma');

import { allRoutes, type Authorize } from '@/security/core';
import type { BusinessRole } from '@/types/auth';
import type { SessionUser } from '@/types/participant';
import prisma from '@/lib/prisma';
import '@/security/registry';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mockSession = require('next-auth/next').getServerSession;

const TAG = 'registry-authz-test';

type Gate = 'public' | 'session' | 'household-member' | 'anyRole' | 'unhandled';

interface RoutePlan {
    endpoint: string;
    method: string;
    routePath: string;
    gate: Gate;
    /** Non-null only for `{ anyRole }` routes — pulled straight from the spec. */
    requiredRoles: BusinessRole[] | null;
}

function planAuthorize(authorize: Authorize): { gate: Gate; requiredRoles: BusinessRole[] | null } {
    if (authorize === 'public') return { gate: 'public', requiredRoles: null };
    if (authorize === 'authenticated' || authorize === 'self') return { gate: 'session', requiredRoles: null };
    if (authorize === 'household-member') return { gate: 'household-member', requiredRoles: null };
    if (typeof authorize === 'object' && authorize !== null && 'anyRole' in authorize) {
        return { gate: 'anyRole', requiredRoles: [...authorize.anyRole] };
    }
    // program-lead-mentor / program-core-volunteer / household-lead / kiosk:
    // not in the current registry. Surfaced as 'unhandled' so a future route
    // can't be silently skipped — it'll fail the explicit guard test below.
    return { gate: 'unhandled', requiredRoles: null };
}

const PLANS: RoutePlan[] = Array.from(allRoutes()).map(([endpoint, spec]) => {
    const [method, routePath] = endpoint.split(' ');
    return { endpoint, method, routePath, ...planAuthorize(spec.authorize) };
});

function importPathFor(routePath: string): string {
    return `@/app${routePath}/route`;
}

describe('Registry route admission gates', () => {
    let plainUser: SessionUser;
    let programId: number;
    const householdIds: number[] = [];
    const participantIds: number[] = [];
    const ENV_BEFORE = process.env.CHECKIN_ENV;

    beforeAll(async () => {
        // Never let the local-kiosk fallback (auth.ts) treat a cookieless,
        // unsigned request as kiosk — that would turn our 401 cases into kiosk.
        process.env.CHECKIN_ENV = 'dev';

        const plain = await prisma.participant.create({
            data: {
                name: 'Authz Plain',
                email: `plain-${TAG}@example.com`,
                household: { create: { name: `Plain ${TAG}` } },
            },
        });
        participantIds.push(plain.id);
        householdIds.push(plain.householdId);
        plainUser = {
            id: plain.id,
            email: plain.email ?? '',
            householdId: plain.householdId,
            isSysadmin: false,
            isBoardMember: false,
            isKeyholder: false,
            isBackgroundCheckReviewer: false,
        };

        // For the public route's 2xx sanity (programs/[id]). memberOnly defaults
        // false, so an anonymous caller is admitted and sees it.
        const program = await prisma.program.create({ data: { name: `Authz Program ${TAG}` } });
        programId = program.id;
    });

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.CHECKIN_ENV = 'dev';
    });

    afterAll(async () => {
        process.env.CHECKIN_ENV = ENV_BEFORE;
        await prisma.program.deleteMany({ where: { id: programId } });
        await prisma.participant.deleteMany({ where: { id: { in: participantIds } } });
        await prisma.household.deleteMany({ where: { id: { in: householdIds } } });
    });

    async function call(plan: RoutePlan): Promise<Response> {
        const mod = (await import(importPathFor(plan.routePath))) as Record<string, unknown>;
        const verb = mod[plan.method] as ((req: Request, ctx?: unknown) => Promise<Response>) | undefined;
        if (typeof verb !== 'function') {
            throw new Error(`${plan.endpoint}: no ${plan.method} export — registry/route out of sync`);
        }
        const url = `http://localhost${plan.routePath.replace(/\[(\w+)\]/g, String(programId))}`;
        const hasParams = /\[(\w+)\]/.test(plan.routePath);
        const ctx = hasParams
            ? { params: Promise.resolve(Object.fromEntries(
                  [...plan.routePath.matchAll(/\[(\w+)\]/g)].map(m => [m[1], String(programId)]),
              )) }
            : undefined;
        return verb(new Request(url, { method: plan.method }), ctx);
    }

    for (const plan of PLANS) {
        describe(plan.endpoint, () => {
            it('has a handled authorize gate (route not silently skipped)', () => {
                expect(plan.gate).not.toBe('unhandled');
            });

            // ── unauthenticated ───────────────────────────────────────────────
            if (plan.gate === 'public') {
                it('admits an unauthenticated caller (public route)', async () => {
                    mockSession.mockResolvedValue(null);
                    const res = await call(plan);
                    expect(res.status).toBeLessThan(400);
                });
            } else {
                it('rejects an unauthenticated caller with 401', async () => {
                    mockSession.mockResolvedValue(null);
                    expect((await call(plan)).status).toBe(401);
                });
            }

            // ── authenticated but under-privileged ───────────────────────────
            if (plan.gate === 'anyRole') {
                const roles = (plan.requiredRoles ?? []).join(' | ');
                it(`rejects an authenticated caller holding none of [${roles}] with 403`, async () => {
                    // plainUser carries every role flag = false → holds none.
                    mockSession.mockResolvedValue({ user: plainUser });
                    expect((await call(plan)).status).toBe(403);
                });
            }
            // session / household-member / public gates have no role-level
            // under-privileged caller — any authenticated (resp. any) caller is
            // admitted by design, so there is no 403 to assert. Field-level
            // scoping for those is covered by policy.contract + route tests.

            // ── allowed (sanity) ─────────────────────────────────────────────
            it('admits an allowed caller (2xx)', async () => {
                if (plan.gate === 'public') {
                    mockSession.mockResolvedValue(null);
                } else if (plan.gate === 'anyRole') {
                    const role = (plan.requiredRoles ?? [])[0];
                    mockSession.mockResolvedValue({ user: { ...plainUser, [role]: true } });
                } else {
                    // session / household-member: any real authenticated user.
                    mockSession.mockResolvedValue({ user: plainUser });
                }
                const res = await call(plan);
                expect(res.status).toBeLessThan(400);
            });
        });
    }
});
