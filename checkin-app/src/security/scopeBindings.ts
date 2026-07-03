/**
 * SCOPE_BINDINGS — the declarative per-row scope table.
 *
 * Ported 1:1 from the imperative `switch (modelName)` that lived in
 * access-resolvers.ts (`scopesHeld`). Each entry says: "the caller holds
 * <scope> on a <Model> row when <Match> holds." The engine (scopes.ts) seeds
 * `everyones` and applies these; the equivalence test
 * (scopeBindingsEquivalence.test.ts) proves set-equality with the old switch
 * across every persona × model × row, which is the contract that this port is
 * behavior-neutral.
 *
 * Field names verified against the LIVE generated map
 * (./generated/classifications.ts), not the §7.4 doc table. Discrepancies found
 * vs that table (see docs/security/auth-consistency-analysis.md §7.4/§7.5):
 *   - Visit:  field is `departedAt` (doc wrote `departed`).            [doc fixed]
 *   - ToolStatus: field is `personId` (renamed userId→participantId #564, then participantId→personId).
 *   - RawBadgeLog: model is `RawBadgeLog` (doc table wrote `RawBadgeEvent`).
 *   - Fee / RSVP: the live switch grouped ProgramParticipant, ProgramVolunteer,
 *     Fee and RSVP under one `case` body that read BOTH `row.programId` and
 *     `row.participantId`. `Fee` has no `participantId` column and `RSVP` has no
 *     `programId` column, so on a REAL row those reads were always `undefined`
 *     and granted nothing. #574 (Step 3 Blocker 1) dropped both dead reads:
 *     `Fee` is unbound (wholly @sensitivity:public, so it needs no binding) and
 *     `RSVP` was narrowed to `their_own`. THIS chip then RE-ADDS the RSVP
 *     program-lead grant correctly via eventId → Event.programId
 *     (ctx.eventIdsInScopePrograms) — a deliberate behavior change, diverging
 *     from the dead switch read. See the RSVP binding below + §7.5/§9 Step 3.
 *
 * IMPORTANT: This file is CODEOWNERS-gated.
 */
import { makeScopesHeld, type ScopeBindings } from './scopes';

export const SCOPE_BINDINGS = {
    Person: {
        their_own: { field: 'id', eqCtx: 'selfId' },
        their_households: { field: 'householdId', eqCtx: 'householdId' },
        their_program_participants: { field: 'id', inCtx: 'participantIdsInScopePrograms' },
        all_current_visitors: {
            all: [{ flag: 'isKeyholder' }, { field: 'id', inCtx: 'activeVisitorIds' }],
        },
    },
    Household: { their_households: { field: 'id', eqCtx: 'householdId' } },
    // Row-scoped (see ROW_SCOPE_KEY): a key-less EmergencyContact row fails closed.
    // their_program_households mirrors TrustedAdult: a program lead/core-vol sees
    // the emergency contacts of the households whose children they oversee
    // (ctx.householdIdsInScopePrograms), granted to those views in registry.ts.
    EmergencyContact: {
        their_households: { field: 'householdId', eqCtx: 'householdId' },
        their_program_households: { field: 'householdId', inCtx: 'householdIdsInScopePrograms' },
    },
    HouseholdLead: {
        their_households: { field: 'householdId', eqCtx: 'householdId' },
        their_own: { field: 'personId', eqCtx: 'selfId' },
    },
    OrgMembership: { their_households: { field: 'householdId', eqCtx: 'householdId' } },
    Program: {
        their_program_participants: { field: 'id', inCtx: ['programsLed', 'programsCoreVolIn'] },
    },
    ProgramParticipant: {
        their_program_participants: {
            field: 'programId',
            inCtx: ['programsLed', 'programsCoreVolIn'],
        },
        their_own: { field: 'personId', eqCtx: 'selfId' },
    },
    ProgramVolunteer: {
        their_program_participants: {
            field: 'programId',
            inCtx: ['programsLed', 'programsCoreVolIn'],
        },
        their_own: { field: 'personId', eqCtx: 'selfId' },
    },
    // Fee + RSVP shared the grouped switch case with ProgramParticipant/
    // ProgramVolunteer, reading BOTH programId and participantId. `Fee` has no
    // participantId column and `RSVP` has no programId column, so those reads
    // were dead. #574 dropped both — Fee is unbound (wholly @sensitivity:public,
    // needs no binding); RSVP was narrowed to `their_own`. THIS chip RE-ADDS the
    // RSVP program-lead grant correctly via eventId → Event.programId
    // (ctx.eventIdsInScopePrograms) — a deliberate behavior CHANGE, not the dead
    // switch read. See docs/security/auth-consistency-analysis.md §7.5 + §9 Step 3.
    RSVP: {
        their_own: { field: 'personId', eqCtx: 'selfId' },
        their_program_participants: { field: 'eventId', inCtx: 'eventIdsInScopePrograms' },
    },
    Event: {
        their_program_participants: {
            field: 'programId',
            inCtx: ['programsLed', 'programsCoreVolIn'],
        },
    },
    FeePayment: {
        their_own: { field: 'personId', eqCtx: 'selfId' },
        their_program_participants: { field: 'personId', inCtx: 'participantIdsInScopePrograms' },
    },
    Visit: {
        their_own: { field: 'personId', eqCtx: 'selfId' },
        all_current_visitors: {
            all: [{ flag: 'isKeyholder' }, { field: 'departedAt', isNull: true }],
        },
    },
    RawBadgeLog: { their_own: { field: 'personId', eqCtx: 'selfId' } },
    ToolStatus: { their_own: { field: 'personId', eqCtx: 'selfId' } },
    Account: { their_own: { field: 'userId', eqCtx: 'selfId' } },
    Session: { their_own: { field: 'userId', eqCtx: 'selfId' } },
    // Bound for coverage; admin-only by tier-grant control (no route grants
    // their_own:internal on AuditLog — only everyones:internal/admin views read
    // audit rows). Audit rows record who-did-what-to-whom (incl. staff actions
    // ON members), so exposing them to the actor would leak investigation/
    // safeguarding context. A "your own actions" view would be a conscious
    // future decision. See docs/security/auth-consistency-analysis.md §7.5.1.
    AuditLog: { their_own: { field: 'actorId', eqCtx: 'selfId' } },
    TrustedAdult: {
        their_households: { field: 'householdId', eqCtx: 'householdId' },
        their_program_households: { field: 'householdId', inCtx: 'householdIdsInScopePrograms' },
        keyholders: { flag: 'isKeyholder' },
    },
    TrustedAdultReview: {
        their_households: { field: 'householdId', eqCtx: 'householdId' },
        their_program_households: { field: 'householdId', inCtx: 'householdIdsInScopePrograms' },
        keyholders: { flag: 'isKeyholder' },
    },
} as const satisfies ScopeBindings;

/**
 * Models whose sensitive fields MUST be gated by a scope key the row carries:
 * if the key is absent (e.g. a query selected the row but not its `householdId`)
 * the resolver returns NO scopes — not even `everyones` — so the stripper drops
 * every sensitive field. Fails CLOSED. This is the old ROW_SCOPE_KEY map; it
 * moved here with the bindings. The §7.3 engine sketch dropped it, but the live
 * switch has it and the EmergencyContact fail-closed unit tests require it.
 */
export const ROW_SCOPE_KEY: Record<string, string> = {
    EmergencyContact: 'householdId',
};

/**
 * Work queue: models that are sensitive AND scopable (could carry a `their_*`
 * relationship) but whose scoped route is not built yet, so they are bound
 * nowhere. A future §9 migration moves each entry OUT of this set and INTO a
 * real SCOPE_BINDINGS binding, in the same PR that ships its handler() route.
 * Done when this set is empty.
 *
 * There is NO permanent opt-out list — structurally un-scopable models (no
 * actor FK) are auto-exempt by isScopable() in validateBindings; "never leaves,
 * even to admins" content is tiered `secret`.
 *
 * NOTE — this DIVERGES from the doc §7.5.1 list, which also names
 * `EmergencyContact`. The live switch already BINDS EmergencyContact (the
 * ROW_SCOPE_KEY pilot case), so it belongs in SCOPE_BINDINGS, not here — the
 * doc's listing is stale (it predates that case landing; §9 Step 4 still treats
 * it as pending). Removed.
 */
export const OPT_OUT_PENDING_ROUTE = new Set<string>([
    'OrgMembershipProcess', // board/admin today; a household-facing status route is plausible
    'BackgroundCheckAttestation', // bind their_own at migration, keep notes `internal`
    'Corporation', // has leads→participantId; a corp-lead view is plausible
    'VolunteerDesignation', // has createdById; confirm whether a self view is warranted
]);

/**
 * The per-row scope resolver. Same signature as the old switch
 * (`(modelName, row, ctx) => Set<Scope>`). access-resolvers.ts re-exports this
 * so every existing `import { scopesHeld } from './access-resolvers'` keeps
 * working unchanged.
 */
export const scopesHeld = makeScopesHeld(SCOPE_BINDINGS, ROW_SCOPE_KEY);
