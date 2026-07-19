/**
 * Per-request context (CallerContext) plus the per-row scope resolver.
 *
 * Two layers of resolution:
 *   1. CallerContext — built once per request: caller's identity, household,
 *      programs led/coreVol'd in, active visitors in the building (if isKeyholder).
 *   2. scopesHeld(modelName, row, ctx) — called once per row in the response:
 *      returns the set of Scopes the caller holds for that particular row.
 *
 * Plus the admission-gate resolver (resolveAccess) for the route entry check,
 * and the per-request role membership test (callerHoldsRole) used by the
 * handler to walk the orderedView.
 *
 * IMPORTANT: This file is CODEOWNERS-gated.
 */
import prisma from '@/lib/prisma';
import type { AuthResult } from '@/types/auth';
import type { Authorize, Role } from './core';
import { LIVE_PERSON } from '@/lib/person/filters';

export interface CallerContext {
    selfId?: number;
    householdId?: number;
    isKeyholder: boolean;
    isKiosk: boolean;
    programsLed: Set<number>;
    programsCoreVolIn: Set<number>;
    /** Union of participant IDs across programsLed ∪ programsCoreVolIn. */
    participantIdsInScopePrograms: Set<number>;
    /** Household IDs of those participants — i.e. households with a child in a
     *  program the caller leads/core-vols. Drives the 'their_program_households' scope. */
    householdIdsInScopePrograms: Set<number>;
    /** Event IDs whose Event.programId is in programsLed ∪ programsCoreVolIn.
     *  RSVP has no programId column (PK [eventId, participantId]); it reaches a
     *  program only via eventId → Event.programId. Drives 'their_program_participants'
     *  on RSVP. */
    eventIdsInScopePrograms: Set<number>;
    /** Person IDs with an un-departed Visit. Only populated for keyholders. */
    activeVisitorIds: Set<number>;
}

export async function buildCallerContext(auth: AuthResult): Promise<CallerContext> {
    const ctx: CallerContext = {
        selfId: undefined,
        householdId: undefined,
        isKeyholder: false,
        isKiosk: auth.type === 'kiosk',
        programsLed: new Set(),
        programsCoreVolIn: new Set(),
        participantIdsInScopePrograms: new Set(),
        householdIdsInScopePrograms: new Set(),
        eventIdsInScopePrograms: new Set(),
        activeVisitorIds: new Set(),
    };

    if (auth.type !== 'session') return ctx;

    ctx.selfId = auth.user.id;
    ctx.householdId = auth.user.householdId;
    ctx.isKeyholder = auth.user.isKeyholder;

    const ledPrograms = await prisma.program.findMany({
        where: { leadMentorId: auth.user.id },
        select: { id: true, participants: { select: { personId: true } } },
    });
    for (const p of ledPrograms) {
        ctx.programsLed.add(p.id);
        for (const pp of p.participants) ctx.participantIdsInScopePrograms.add(pp.personId);
    }

    const coreVols = await prisma.programVolunteer.findMany({
        where: { personId: auth.user.id, isCore: true },
        select: {
            programId: true,
            program: { select: { participants: { select: { personId: true } } } },
        },
    });
    for (const v of coreVols) {
        ctx.programsCoreVolIn.add(v.programId);
        for (const pp of v.program.participants) ctx.participantIdsInScopePrograms.add(pp.personId);
    }

    // Households of the children in the caller's programs — for Trusted Adult
    // pickup-note visibility (program leads see operational notes for the
    // households whose kids they oversee).
    if (ctx.participantIdsInScopePrograms.size) {
        const members = await prisma.person.findMany({
            where: { id: { in: [...ctx.participantIdsInScopePrograms] }, ...LIVE_PERSON },
            select: { householdId: true },
        });
        for (const m of members) ctx.householdIdsInScopePrograms.add(m.householdId);
    }

    // Events belonging to the caller's programs — RSVP reaches a program only via
    // eventId → Event.programId (RSVP has no programId column). Drives the
    // 'their_program_participants' scope on RSVP rows.
    const scopePrograms = [...ctx.programsLed, ...ctx.programsCoreVolIn];
    if (scopePrograms.length) {
        const events = await prisma.event.findMany({
            where: { programId: { in: scopePrograms } },
            select: { id: true },
        });
        for (const e of events) ctx.eventIdsInScopePrograms.add(e.id);
    }

    if (ctx.isKeyholder) {
        const visits = await prisma.visit.findMany({
            where: { departedAt: null },
            select: { personId: true },
        });
        for (const v of visits) ctx.activeVisitorIds.add(v.personId);
    }

    return ctx;
}

/**
 * Per-row scope resolver. The imperative `switch (modelName)` that used to live
 * here is now a declarative `SCOPE_BINDINGS` table interpreted by one engine
 * (scopes.ts), so the bindings can be checked in CI (field typos, forgotten
 * models, route-grant seam). Behavior is identical — proved by the S1
 * equivalence test (tests/security/scopeBindingsEquivalence.test.ts) which
 * asserted set-equality with the old switch across every persona × model × row
 * before this swap. Re-exported here so existing call sites
 * (`import { scopesHeld } from './access-resolvers'`) are unchanged.
 *
 * The old `ROW_SCOPE_KEY` fail-closed map moved to scopeBindings.ts (it gates
 * EmergencyContact: a key-less row yields NO scopes, not even `everyones`).
 */
export { scopesHeld } from './scopeBindings';

/** A certifier holds at least one MAY_CERTIFY_OTHERS toolStatus on the session. */
function isCertifier(auth: AuthResult): boolean {
    return (
        auth.type === 'session' &&
        (auth.user.toolStatuses ?? []).some(ts => ts.level === 'MAY_CERTIFY_OTHERS')
    );
}

export function callerHoldsRole(
    role: Role,
    auth: AuthResult,
    params: Record<string, string>,
    ctx: CallerContext,
): boolean {
    switch (role) {
        case 'anyone':
            return true;
        case 'unauthenticated':
            return auth.type === 'unauthenticated';
        case 'authenticated':
            return auth.type === 'session';
        case 'kiosk':
            return auth.type === 'kiosk';
        case 'isSysadmin':
            return auth.type === 'session' && auth.user.isSysadmin;
        case 'isBoardMember':
            return auth.type === 'session' && auth.user.isBoardMember;
        case 'isKeyholder':
            return auth.type === 'session' && auth.user.isKeyholder;
        case 'isBackgroundCheckReviewer':
            return auth.type === 'session' && auth.user.isBackgroundCheckReviewer;
        case 'isOperations':
            // SessionUser (types/participant.ts) doesn't declare isOperations yet —
            // that lands with the roles-foundation PR (which stamps the flag on the
            // session). This boundary PR adds the role vocabulary alone, ahead of
            // it; the structural cast reads the flag once it exists without
            // widening this PR's diff outside src/security/** (isolation-enforced).
            // Falls back to false (default-deny) until roles-foundation lands.
            return auth.type === 'session' && !!(auth.user as { isOperations?: boolean }).isOperations;
        case 'certifier':
            return isCertifier(auth);
        case 'householdLead':
            return auth.type === 'session' && !!auth.user.householdLead;
        case 'programLeadMentor': {
            const id = parseInt(params.id ?? '', 10);
            return !isNaN(id) && ctx.programsLed.has(id);
        }
        case 'programCoreVolunteer': {
            const id = parseInt(params.id ?? '', 10);
            return !isNaN(id) && ctx.programsCoreVolIn.has(id);
        }
    }
}

export interface ResolverContext {
    auth: AuthResult;
    params: Record<string, string>;
    callerContext: CallerContext;
}

/**
 * Admission gate — the per-route `authorize` check. Returns whether the
 * caller is even allowed to *invoke* the endpoint (401/403 if not). View
 * resolution (orderedView) is downstream.
 */
export async function resolveAccess(
    authorize: Authorize,
    ctx: ResolverContext,
): Promise<{ allowed: boolean }> {
    const { auth, params, callerContext } = ctx;
    const isAdmin = auth.type === 'session' && (auth.user.isSysadmin || auth.user.isBoardMember);

    if (typeof authorize === 'string') {
        switch (authorize) {
            case 'public':
                return { allowed: true };
            case 'authenticated':
                return { allowed: auth.type === 'session' };
            case 'self': {
                if (auth.type !== 'session') return { allowed: false };
                // Bind to the resource id param. No id param (e.g. GET /api/profile)
                // → 'self' just means authenticated; the handler scopes to
                // auth.user.id itself. Present-but-mismatched → fail closed.
                const target = params.id ?? params.participantId;
                if (target === undefined) return { allowed: true };
                const targetId = parseInt(target, 10);
                return { allowed: !isNaN(targetId) && targetId === auth.user.id };
            }
            case 'kiosk':
                return { allowed: auth.type === 'kiosk' };
            case 'certifier':
                // Certifiers see the shop member roster; admins always may too.
                return { allowed: isCertifier(auth) || isAdmin };
            case 'program-lead-mentor': {
                const id = parseInt(params.id ?? '', 10);
                if (isNaN(id)) return { allowed: false };
                return { allowed: callerContext.programsLed.has(id) || isAdmin };
            }
            case 'program-core-volunteer': {
                const id = parseInt(params.id ?? '', 10);
                if (isNaN(id)) return { allowed: false };
                return { allowed: callerContext.programsCoreVolIn.has(id) || isAdmin };
            }
            case 'household-lead': {
                if (auth.type !== 'session') return { allowed: false };
                return { allowed: !!auth.user.householdLead || isAdmin };
            }
            case 'household-member': {
                if (auth.type !== 'session') return { allowed: false };
                return { allowed: auth.user.householdId !== undefined || isAdmin };
            }
        }
    } else if ('anyRole' in authorize) {
        if (auth.type !== 'session') return { allowed: false };
        return { allowed: authorize.anyRole.some(r => auth.user[r] === true) };
    }
    return { allowed: false };
}
