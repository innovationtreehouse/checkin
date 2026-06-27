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
            ['their_own:pii', 'their_own:personal', 'their_own:internal', 'public'],
        ],
    ],
});

defineRoute({
    endpoint: 'GET /api/programs/[id]',
    authorize: 'public',
    envelope: null,
    orderedView: [
        ['sysadmin',             ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor',    ['their_program_participants:pii',
                                  'their_program_participants:personal',
                                  'public']],
        ['programCoreVolunteer', ['their_program_participants:pii',
                                  'their_program_participants:personal',
                                  'public']],
        ['authenticated',        ['their_own:pii', 'their_own:personal', 'public']],
        ['anyone',               ['public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/directory/board',
    authorize: { anyRole: ['sysadmin', 'boardMember', 'keyholder'] },
    envelope: 'boardMembers',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['keyholder',   ['public']],
    ],
});

// Board's in-flight membership applications. Exposes every applicant household's
// PII (parents + children names/emails), so only sysadmin/board may see it, and
// the field grant is explicit per role.
defineRoute({
    endpoint: 'GET /api/admin/membership',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'processes',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

// Background-check reviewers' queue. Reviewers must see applicant parents' names
// + emails (to look them up on Averity) but NOT internal/personal fields — so the
// grant is deliberately limited to pii + public.
defineRoute({
    endpoint: 'GET /api/membership/reviews',
    authorize: { anyRole: ['backgroundCheckReviewer'] },
    envelope: 'queue',
    orderedView: [
        ['backgroundCheckReviewer', ['everyones:pii', 'public']],
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
        ['authenticated', ['their_households:pii', 'their_households:personal', 'public']],
    ],
});

// Board's trusted-adult review queue. Full visibility incl. familyContext (pii)
// and the board's internal decision notes (internal).
defineRoute({
    endpoint: 'GET /api/admin/trusted-adults',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'trustedAdults',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
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
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['keyholder',   ['keyholders:personal', 'their_program_households:personal', 'their_households:personal', 'public']],
        // Catch-all: program leads (and household members) match here. Scopes are
        // per-row, so a caller only receives 'personal' on rows where they hold
        // their_program_households (a kid in their program) or their_households.
        ['authenticated', ['their_program_households:personal', 'their_households:personal', 'public']],
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
