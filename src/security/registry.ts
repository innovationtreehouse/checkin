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

// ─── Admin routes ──────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/admin/audit',
    authorize: { anyRole: ['sysadmin'] },
    envelope: 'logs',
    orderedView: [
        ['sysadmin', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/admin/badges',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'badges',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/admin/orphans',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'orphans',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/admin/roles',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participants',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/admin/roles',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'user',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/admin/visits',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'visits',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/admin/visits',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'visit',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
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
