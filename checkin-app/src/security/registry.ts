/**
 * THE security policy. One entry per API endpoint and one per outbound surface.
 *
 * Every change here is a change to what data leaves the server, to which
 * role, through which channel. CODEOWNERS-gated.
 *
 * orderedView is walked top-to-bottom; the first role the caller satisfies
 * decides the view. Order matters — treat reorders as policy changes.
 */
import { defineRoute, defineOutbound } from './core';

// ─── Routes ────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/profile',
    authorize: 'self',
    envelope: 'profile',
    orderedView: [
        [
            'authenticated',
            ['their_own:pii', 'their_own:personal', 'their_own:internal', 'member', 'public'],
        ],
    ],
});

defineRoute({
    endpoint: 'GET /api/programs/[id]',
    authorize: 'public',
    envelope: null,
    orderedView: [
        ['isSysadmin',             ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['programLeadMentor',    ['their_program_participants:pii',
                                  'their_program_participants:personal',
                                  'member', 'public']],
        ['programCoreVolunteer', ['their_program_participants:pii',
                                  'their_program_participants:personal',
                                  'member', 'public']],
        ['authenticated',        ['their_own:pii', 'their_own:personal', 'member', 'public']],
        ['anyone',               ['public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/directory/board',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember', 'isKeyholder'] },
    envelope: 'boardMembers',
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isKeyholder',   ['member', 'public']],
    ],
});

// Board's in-flight membership applications. Exposes every applicant household's
// PII (parents + children names/emails), so only isSysadmin/board may see it, and
// the field grant is explicit per role.
defineRoute({
    endpoint: 'GET /api/membership-ops/applications',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: 'processes',
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Admin merge-analysis view: two participants side-by-side (household + activity
// counts) for the merge tool. Full participant PII to sysadmin/board only.
defineRoute({
    endpoint: 'GET /api/membership-ops/participants/merge/analyze',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: 'participants',
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Admin households list / single-household lookup. Exposes every household's
// members (names + emails) + primary emergency contact (personal), so only
// sysadmin/board may see the sensitive bands.
defineRoute({
    endpoint: 'GET /api/membership-ops/households',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: 'households',
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Background-check reviewers' queue. Reviewers must see applicant parents' names
// + emails (to look them up on Averity) but NOT internal/personal fields — so the
// grant is deliberately limited to pii + public.
defineRoute({
    endpoint: 'GET /api/membership/reviews',
    authorize: { anyRole: ['isBackgroundCheckReviewer'] },
    envelope: 'queue',
    orderedView: [
        ['isBackgroundCheckReviewer', ['everyones:pii', 'member', 'public']],
    ],
});

// The caller's household trusted adults. Household-scoped: members/leads see the
// family context (pii band) + the board's shared note (personal) + status/dates,
// but never the board's internal decision notes.
defineRoute({
    endpoint: 'GET /api/trusted-adults/mine',
    authorize: 'household-member',
    envelope: 'trustedAdults',
    orderedView: [
        ['authenticated', ['their_households:pii', 'their_households:personal', 'member', 'public']],
    ],
});

// Board's trusted-adult review queue. Full visibility incl. familyContext (pii)
// and the board's internal decision notes (internal).
defineRoute({
    endpoint: 'GET /api/safety/trusted-adults',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: 'trustedAdults',
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Operational pickup view for keyholders (global) and program leads (the
// households whose kids they oversee). They get the board's shared note + the
// adult's name/contact (personal), but NOT the family's board-facing context
// (pii) or the board's internal notes (internal). The handler restricts which
// rows are returned; this view is the field-level backstop.
defineRoute({
    endpoint: 'GET /api/trusted-adults/operational',
    authorize: 'authenticated',
    envelope: 'trustedAdults',
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isKeyholder',   ['keyholders:personal', 'their_program_households:personal', 'their_households:personal', 'member', 'public']],
        // Catch-all: program leads (and household members) match here. Scopes are
        // per-row, so a caller only receives 'personal' on rows where they hold
        // their_program_households (a kid in their program) or their_households.
        ['authenticated', ['their_program_households:personal', 'their_households:personal', 'member', 'public']],
    ],
});

// ─── Outbound surfaces ─────────────────────────────────────────────────────

defineOutbound({
    surface: 'shopify.product.create',
    // Program name + prices + maxParticipants — all 'public' tier.
    tiers: ['public'],
});

defineOutbound({
    surface: 'email.admin-notify',
    // Email address is 'pii' tier; the address is the entire payload here.
    tiers: ['public', 'pii'],
});
