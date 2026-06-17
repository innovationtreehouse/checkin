/**
 * Security policy core: types and the registry singleton.
 *
 * Token grammar:
 *   'public'                — public-tier fields, always visible (no row gate)
 *   '<scope>:<tier>'        — tier ∈ {pii, personal, internal}; the grant
 *                             applies on rows where the caller holds <scope>
 *   scope = 'everyones'     — unconditional (broad grant, no row check)
 *   scope = 'their_own' | 'their_households' | 'their_program_participants'
 *           | 'all_current_visitors' — per-row predicates evaluated by the
 *                             handler against a prefetched CallerContext.
 *
 * Field visibility (per row):
 *   - field.tier === 'secret'        → never
 *   - field.tier === 'public'        → iff view includes 'public'
 *   - otherwise (pii/personal/internal):
 *       iff view includes 'everyones:<tier>',
 *       OR view includes '<scope>:<tier>' for some <scope> the caller holds
 *       on this row.
 *
 * Roles select the view at request time (first match wins in orderedView).
 * Scopes select fields at row time (computed by access-resolvers per row).
 *
 * IMPORTANT: This file is CODEOWNERS-gated.
 */
import { classifications, type Models, type FieldsOf } from './generated/classifications';
import type { BusinessRole } from '@/types/auth';

export type { Models, FieldsOf };
export { classifications };

export type SensitiveTier = 'pii' | 'personal' | 'internal';
export type Tier = 'public' | SensitiveTier | 'secret';

export type Scope =
    | 'everyones'
    | 'their_own'
    | 'their_households'
    | 'their_program_participants'
    // Caller leads/core-vols a program that a child of this row's household is
    // enrolled in (used for Trusted Adult pickup notes).
    | 'their_program_households'
    // Caller is a keyholder (global — front-desk staff). Unconditional per-row.
    | 'keyholders'
    | 'all_current_visitors';

export type Token = 'public' | `${Scope}:${SensitiveTier}`;

/**
 * Role vocabulary. Roles are properties of the caller (sometimes parameterised
 * by request params), not of any row. Per-row data scoping lives in `Scope`.
 */
export type Role =
    | 'anyone'
    | 'unauthenticated'
    | 'authenticated'
    | 'kiosk'
    | 'sysadmin'
    | 'boardMember'
    | 'keyholder'
    | 'backgroundCheckReviewer'
    | 'householdLead'
    | 'programLeadMentor'
    | 'programCoreVolunteer';

const VALID_SCOPES = new Set<Scope>([
    'everyones',
    'their_own',
    'their_households',
    'their_program_participants',
    'their_program_households',
    'keyholders',
    'all_current_visitors',
]);
const VALID_SENSITIVE_TIERS = new Set<SensitiveTier>(['pii', 'personal', 'internal']);
const VALID_ROLES = new Set<Role>([
    'anyone',
    'unauthenticated',
    'authenticated',
    'kiosk',
    'sysadmin',
    'boardMember',
    'keyholder',
    'backgroundCheckReviewer',
    'householdLead',
    'programLeadMentor',
    'programCoreVolunteer',
]);

export function parseToken(t: string): { scope: Scope; tier: SensitiveTier } | 'public' | null {
    if (t === 'public') return 'public';
    const colon = t.indexOf(':');
    if (colon < 1) return null;
    const scope = t.slice(0, colon);
    const tier = t.slice(colon + 1);
    if (!VALID_SCOPES.has(scope as Scope)) return null;
    if (!VALID_SENSITIVE_TIERS.has(tier as SensitiveTier)) return null;
    return { scope: scope as Scope, tier: tier as SensitiveTier };
}

/**
 * Admission gate — who is allowed to *call* the endpoint. Distinct from
 * `orderedView`, which controls *what* they see once admitted.
 */
export type Authorize =
    | 'public'
    | 'authenticated'
    | 'self'
    | { anyRole: BusinessRole[] }
    | 'program-lead-mentor'
    | 'program-core-volunteer'
    | 'household-lead'
    | 'household-member'
    | 'kiosk';

/**
 * Response envelope:
 *   - string key  → `{ [key]: payload }`
 *   - null        → payload directly (no wrapper)
 */
export type Envelope = string | null;

export type OrderedViewEntry = readonly [Role, readonly Token[]];

export interface RouteSpec {
    endpoint: string;
    authorize: Authorize;
    envelope: Envelope;
    /**
     * Ordered list of (role, token-grant). The handler walks top-to-bottom
     * and uses the first role the caller satisfies. Order matters and is
     * part of the policy — a CODEOWNERS reviewer should treat reorders as
     * meaningful.
     */
    orderedView: readonly OrderedViewEntry[];
}

/**
 * Outbound surfaces have no caller — the data is being sent to a third party.
 * `tiers` is the unconditional list of tiers allowed on the wire. Anything
 * not listed (and `secret` regardless) is stripped before `send()` runs.
 */
export interface OutboundSpec {
    surface: string;
    tiers: readonly ('public' | SensitiveTier)[];
}

const _routes = new Map<string, RouteSpec>();
const _outbounds = new Map<string, OutboundSpec>();

export function defineRoute(spec: RouteSpec): RouteSpec {
    if (_routes.has(spec.endpoint)) {
        throw new Error(`Duplicate route registration: ${spec.endpoint}`);
    }
    const seenRoles = new Set<string>();
    for (const [role, tokens] of spec.orderedView) {
        if (!VALID_ROLES.has(role)) {
            throw new Error(`Route ${spec.endpoint}: unknown role '${role}'`);
        }
        if (seenRoles.has(role)) {
            throw new Error(`Route ${spec.endpoint}: duplicate role '${role}' in orderedView`);
        }
        seenRoles.add(role);
        for (const tok of tokens) {
            if (parseToken(tok) === null) {
                throw new Error(`Route ${spec.endpoint}: invalid token '${tok}'`);
            }
        }
    }
    _routes.set(spec.endpoint, spec);
    return spec;
}

export function defineOutbound(spec: OutboundSpec): OutboundSpec {
    if (_outbounds.has(spec.surface)) {
        throw new Error(`Duplicate outbound surface: ${spec.surface}`);
    }
    for (const t of spec.tiers) {
        if (t !== 'public' && !VALID_SENSITIVE_TIERS.has(t as SensitiveTier)) {
            throw new Error(`Outbound ${spec.surface}: invalid tier '${t}'`);
        }
    }
    _outbounds.set(spec.surface, spec);
    return spec;
}

export function getRoute(endpoint: string): RouteSpec | undefined {
    return _routes.get(endpoint);
}

export function getOutbound(surface: string): OutboundSpec | undefined {
    return _outbounds.get(surface);
}

export function allRoutes(): IterableIterator<[string, RouteSpec]> {
    return _routes.entries();
}

export function allOutbounds(): IterableIterator<[string, OutboundSpec]> {
    return _outbounds.entries();
}

/**
 * The single field-visibility predicate used by both the handler stripper
 * and the contract tests.
 */
export function fieldVisible(
    tier: Tier,
    tokens: readonly Token[],
    scopesHeld: ReadonlySet<Scope>,
): boolean {
    if (tier === 'secret') return false;
    if (tier === 'public') return tokens.includes('public');
    for (const tok of tokens) {
        if (tok === 'public') continue;
        const parsed = parseToken(tok);
        if (parsed === null || parsed === 'public') continue;
        if (parsed.tier !== tier) continue;
        if (parsed.scope === 'everyones') return true;
        if (scopesHeld.has(parsed.scope)) return true;
    }
    return false;
}
