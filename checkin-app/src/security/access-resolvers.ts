/**
 * Per-request context (CallerContext) plus the per-row scope resolver.
 *
 * Two layers of resolution:
 *   1. CallerContext — built once per request: caller's identity, household,
 *      programs led/coreVol'd in, active visitors in the building (if keyholder).
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
import type { Authorize, Role, Scope } from './core';

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
    /** Participant IDs with an un-departed Visit. Only populated for keyholders. */
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
        activeVisitorIds: new Set(),
    };

    if (auth.type !== 'session') return ctx;

    ctx.selfId = auth.user.id;
    ctx.householdId = auth.user.householdId;
    ctx.isKeyholder = auth.user.keyholder;

    const ledPrograms = await prisma.program.findMany({
        where: { leadMentorId: auth.user.id },
        select: { id: true, participants: { select: { participantId: true } } },
    });
    for (const p of ledPrograms) {
        ctx.programsLed.add(p.id);
        for (const pp of p.participants) ctx.participantIdsInScopePrograms.add(pp.participantId);
    }

    const coreVols = await prisma.programVolunteer.findMany({
        where: { participantId: auth.user.id, isCore: true },
        select: {
            programId: true,
            program: { select: { participants: { select: { participantId: true } } } },
        },
    });
    for (const v of coreVols) {
        ctx.programsCoreVolIn.add(v.programId);
        for (const pp of v.program.participants) ctx.participantIdsInScopePrograms.add(pp.participantId);
    }

    // Households of the children in the caller's programs — for Trusted Adult
    // pickup-note visibility (program leads see operational notes for the
    // households whose kids they oversee).
    if (ctx.participantIdsInScopePrograms.size) {
        const members = await prisma.participant.findMany({
            where: { id: { in: [...ctx.participantIdsInScopePrograms] } },
            select: { householdId: true },
        });
        for (const m of members) ctx.householdIdsInScopePrograms.add(m.householdId);
    }

    if (ctx.isKeyholder) {
        const visits = await prisma.visit.findMany({
            where: { departedAt: null },
            select: { participantId: true },
        });
        for (const v of visits) ctx.activeVisitorIds.add(v.participantId);
    }

    return ctx;
}

/**
 * Models whose sensitive fields MUST be gated per-row by a scope key the row
 * carries. If that key isn't present on the (possibly nested) row — e.g. a
 * query selected the row but not its `householdId` — we cannot prove the
 * caller's relationship to it, so `scopesHeld` returns NO scopes (not even
 * `'everyones'`) and the stripper drops every sensitive field. This fails
 * CLOSED: a missing selected column must never let an `everyones:*` (admin/
 * board) view leak a whole row. Each entry also needs a `case` below that
 * derives the row-scoped grant from the same key.
 */
const ROW_SCOPE_KEY: Record<string, string> = {
    EmergencyContact: 'householdId',
};

/**
 * Per-row scope resolver. Returns the set of Scopes the caller holds on the
 * given row. `'everyones'` is included for non-row-scoped models (unconditional
 * scope); for models in `ROW_SCOPE_KEY` it is granted only once the row's scope
 * key is present, so a key-less row fails closed.
 */
export function scopesHeld(
    modelName: string,
    row: Record<string, unknown> | null | undefined,
    ctx: CallerContext,
): Set<Scope> {
    if (!row || typeof row !== 'object') {
        // No row to gate on. Row-scoped models fail closed; others get the broad scope.
        return modelName in ROW_SCOPE_KEY ? new Set<Scope>() : new Set<Scope>(['everyones']);
    }

    const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

    // Defense-in-depth: row-scoped model missing its scope key → fail closed.
    const scopeKey = ROW_SCOPE_KEY[modelName];
    if (scopeKey !== undefined && num(row[scopeKey]) === undefined) {
        return new Set<Scope>();
    }

    const scopes = new Set<Scope>(['everyones']);

    switch (modelName) {
        case 'Participant': {
            const id = num(row.id);
            const householdId = num(row.householdId);
            if (id !== undefined && id === ctx.selfId) scopes.add('their_own');
            if (householdId !== undefined && householdId === ctx.householdId) scopes.add('their_households');
            if (id !== undefined && ctx.participantIdsInScopePrograms.has(id)) {
                scopes.add('their_program_participants');
            }
            if (id !== undefined && ctx.isKeyholder && ctx.activeVisitorIds.has(id)) {
                scopes.add('all_current_visitors');
            }
            break;
        }
        case 'Household': {
            const id = num(row.id);
            if (id !== undefined && id === ctx.householdId) scopes.add('their_households');
            break;
        }
        case 'EmergencyContact': {
            // Row-scoped (see ROW_SCOPE_KEY): householdId is guaranteed present
            // by the fail-closed guard above. Belongs to one household, so the
            // household's own members/leads see its personal fields.
            const householdId = num(row.householdId);
            if (householdId !== undefined && householdId === ctx.householdId) {
                scopes.add('their_households');
            }
            break;
        }
        case 'HouseholdLead': {
            const householdId = num(row.householdId);
            const participantId = num(row.participantId);
            if (householdId !== undefined && householdId === ctx.householdId) {
                scopes.add('their_households');
            }
            if (participantId !== undefined && participantId === ctx.selfId) scopes.add('their_own');
            break;
        }
        case 'Membership': {
            const householdId = num(row.householdId);
            if (householdId !== undefined && householdId === ctx.householdId) {
                scopes.add('their_households');
            }
            break;
        }
        case 'Program': {
            const id = num(row.id);
            if (id !== undefined && (ctx.programsLed.has(id) || ctx.programsCoreVolIn.has(id))) {
                scopes.add('their_program_participants');
            }
            break;
        }
        case 'ProgramParticipant':
        case 'ProgramVolunteer':
        case 'Fee':
        case 'RSVP': {
            const programId = num(row.programId);
            const participantId = num(row.participantId);
            if (
                programId !== undefined &&
                (ctx.programsLed.has(programId) || ctx.programsCoreVolIn.has(programId))
            ) {
                scopes.add('their_program_participants');
            }
            if (participantId !== undefined && participantId === ctx.selfId) scopes.add('their_own');
            break;
        }
        case 'Event': {
            const programId = num(row.programId);
            if (
                programId !== undefined &&
                (ctx.programsLed.has(programId) || ctx.programsCoreVolIn.has(programId))
            ) {
                scopes.add('their_program_participants');
            }
            break;
        }
        case 'FeePayment': {
            const participantId = num(row.participantId);
            if (participantId !== undefined && participantId === ctx.selfId) scopes.add('their_own');
            if (participantId !== undefined && ctx.participantIdsInScopePrograms.has(participantId)) {
                scopes.add('their_program_participants');
            }
            break;
        }
        case 'Visit': {
            const participantId = num(row.participantId);
            if (participantId !== undefined && participantId === ctx.selfId) scopes.add('their_own');
            if (ctx.isKeyholder && row.departedAt == null) {
                scopes.add('all_current_visitors');
            }
            break;
        }
        case 'RawBadgeLog': {
            const participantId = num(row.participantId);
            if (participantId !== undefined && participantId === ctx.selfId) scopes.add('their_own');
            break;
        }
        case 'ToolStatus':
        case 'Account':
        case 'Session': {
            const userId = num(row.userId);
            if (userId !== undefined && userId === ctx.selfId) scopes.add('their_own');
            break;
        }
        case 'TrustedAdult':
        case 'TrustedAdultReview': {
            // A Trusted Adult belongs to a household. householdId is denormalized
            // onto review rows so nested rows resolve the same scopes.
            //   their_households         → the household's own members/leads (sees
            //                              familyContext[pii] + notes[personal]).
            //   their_program_households → a program lead of the household's kids
            //                              (sees personal-tier notes, NOT pii).
            //   keyholders               → any keyholder, global (personal-tier notes).
            // The board's familyContext (pii) and decisionNote (internal) are never
            // granted to the program/keyholder scopes.
            const householdId = num(row.householdId);
            if (householdId !== undefined && householdId === ctx.householdId) scopes.add('their_households');
            if (householdId !== undefined && ctx.householdIdsInScopePrograms.has(householdId)) {
                scopes.add('their_program_households');
            }
            if (ctx.isKeyholder) scopes.add('keyholders');
            break;
        }
        // MembershipProcess, BackgroundCheckAttestation, Corporation,
        // CorporationLead, CorporationMember, AuditLog, VerificationToken,
        // ErrorLog, SystemMetricLog, Tool — no per-row scopes beyond 'everyones'
        // yet. Admin (sysadmin/boardMember) views grant 'everyones:*' so they
        // still get through. These SHOULD be row-scoped too (they carry
        // membershipId / processId / corporationId); until each has a case +
        // ROW_SCOPE_KEY entry, a non-admin view cannot see them and an admin
        // view sees them ungated. Add them to ROW_SCOPE_KEY as cases land.
        // ponytail: EmergencyContact done first (carries householdId);
        // extend to the rest when a route needs non-admin access to them.
    }
    return scopes;
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
        case 'sysadmin':
            return auth.type === 'session' && auth.user.sysadmin;
        case 'boardMember':
            return auth.type === 'session' && auth.user.boardMember;
        case 'keyholder':
            return auth.type === 'session' && auth.user.keyholder;
        case 'backgroundCheckReviewer':
            return auth.type === 'session' && auth.user.backgroundCheckReviewer;
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
    const isAdmin = auth.type === 'session' && (auth.user.sysadmin || auth.user.boardMember);

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
