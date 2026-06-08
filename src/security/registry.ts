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
