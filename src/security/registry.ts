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

defineRoute({
    endpoint: 'GET /api/admin/emergency-contacts',
    authorize: { anyRole: ['sysadmin', 'boardMember', 'keyholder'] },
    envelope: 'households',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['keyholder',   ['everyones:pii', 'everyones:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/admin/households',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'households',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/admin/households',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'membership',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/admin/participants/search',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participants',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/admin/participants/merge/analyze',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participants',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/admin/participants',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participant',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PUT /api/admin/participants/[id]',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participant',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/admin/participants/[id]/household',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participant',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/admin/participants/merge',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participant',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

// ─── Admin routes: aggregated/computed responses (stripper bypassed) ──────
// These return computed values (percentile stats, parse previews, import
// counts) rather than model rows, so there's nothing for the field-level
// stripper to gate. They opt in via `dangerously_allow_all_data_access:
// true` (snake_case intentional — same trick as React's dangerouslySet-
// InnerHTML, surfaces the risk in every review). `authorize` is the only
// enforcement — only sysadmin / board (and keyholders for system-health)
// can call them.

defineRoute({
    endpoint: 'GET /api/admin/system-health',
    authorize: { anyRole: ['sysadmin', 'boardMember', 'keyholder'] },
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/admin/trends',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'POST /api/admin/participants/import',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'POST /api/admin/participants/import/preview',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

// ─── Household ─────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/household',
    authorize: 'authenticated',
    envelope: 'household',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/household',
    authorize: 'authenticated',
    envelope: 'household',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/household',
    authorize: 'household-lead',
    envelope: 'member',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/household/lead',
    authorize: 'household-lead',
    envelope: 'lead',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'DELETE /api/household/lead',
    authorize: 'household-lead',
    envelope: 'lead',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/household/member',
    authorize: 'household-lead',
    envelope: 'member',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/household/settings',
    authorize: 'household-lead',
    envelope: 'household',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/household/visits',
    authorize: 'authenticated',
    envelope: 'visits',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

// ─── Profile (remainder) ───────────────────────────────────────────────────

defineRoute({
    endpoint: 'PATCH /api/profile',
    authorize: 'self',
    envelope: 'profile',
    orderedView: [
        ['authenticated', ['their_own:pii', 'their_own:personal', 'their_own:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/profile/onboarding',
    authorize: 'self',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/profile/onboarding-status',
    authorize: 'self',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/profile/visits',
    authorize: 'self',
    envelope: 'visits',
    orderedView: [
        ['authenticated', ['their_own:pii', 'their_own:personal', 'their_own:internal', 'public']],
    ],
});

// ─── Kiosk ─────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/kiosk/certifications',
    // Admits both authenticated sessions and verified kiosks; the handler
    // checks auth.type for the OR and throws 401 otherwise. The framework's
    // single-token authorize model can't express OR-of-auth-types yet.
    authorize: 'public',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/kiosk/version',
    authorize: 'public',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

// ─── Health ────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/health',
    authorize: 'public',
    envelope: null,
    orderedView: [['anyone', ['public']]],
    dangerously_allow_all_data_access: true,
});

// ─── Events ────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'POST /api/events',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/events/mine',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [
        ['sysadmin',             ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor',    ['their_program_participants:pii',
                                  'their_program_participants:personal', 'public']],
        ['programCoreVolunteer', ['their_program_participants:pii',
                                  'their_program_participants:personal', 'public']],
        ['authenticated',        ['their_own:pii', 'their_own:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/events/[id]',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [
        ['sysadmin',             ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor',    ['their_program_participants:pii',
                                  'their_program_participants:personal',
                                  'their_program_participants:internal', 'public']],
        ['programCoreVolunteer', ['their_program_participants:pii',
                                  'their_program_participants:personal', 'public']],
        ['authenticated',        ['their_own:pii', 'their_own:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/events/[id]',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'POST /api/events/[id]/attendance',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'PATCH /api/events/[id]/rsvp',
    authorize: 'authenticated',
    envelope: 'rsvp',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal', 'public']],
    ],
});

// ─── Attendance ────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/attendance',
    // Aggregated counts + safety state + filtered visit lists per role; the
    // shape isn't a ModelBag. authorize gate + handler-internal role checks.
    authorize: 'public',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'DELETE /api/attendance',
    authorize: 'authenticated',
    envelope: 'visit',
    orderedView: [
        ['sysadmin',      ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',   ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['keyholder',     ['everyones:pii', 'everyones:personal', 'public',
                           'all_current_visitors:pii', 'all_current_visitors:personal']],
        ['authenticated', ['their_own:pii', 'their_own:personal',
                           'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/attendance',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [],
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'POST /api/attendance/manual',
    authorize: 'self',
    envelope: 'visit',
    orderedView: [
        ['authenticated', ['their_own:pii', 'their_own:personal', 'public']],
    ],
});

// ─── Programs ──────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/programs',
    authorize: 'public',
    envelope: null,
    orderedView: [
        ['sysadmin',             ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor',    ['their_program_participants:pii',
                                  'their_program_participants:personal', 'public']],
        ['programCoreVolunteer', ['their_program_participants:pii',
                                  'their_program_participants:personal', 'public']],
        ['authenticated',        ['their_own:pii', 'their_own:personal', 'public']],
        ['anyone',               ['public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/programs',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'program',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/programs/payment-plans',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'requests',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/programs/payment-plans',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: 'participant',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/programs/[id]',
    authorize: 'program-lead-mentor',
    envelope: 'program',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/programs/[id]/eligible-participants',
    authorize: 'program-lead-mentor',
    envelope: 'members',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['everyones:pii', 'everyones:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/programs/[id]/events',
    authorize: 'program-lead-mentor',
    envelope: 'event',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/programs/[id]/participants',
    // Self-enrollment, household-lead enrollment, or admin override; the
    // handler-internal check enforces the row-level rules.
    authorize: 'authenticated',
    envelope: 'enrollment',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated',     ['their_own:pii', 'their_own:personal',
                               'their_households:pii', 'their_households:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'DELETE /api/programs/[id]/participants',
    authorize: 'authenticated',
    envelope: 'enrollment',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal', 'public']],
        ['authenticated',     ['their_own:pii', 'their_own:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/programs/[id]/publish',
    authorize: 'program-lead-mentor',
    envelope: 'program',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/programs/[id]/request-payment-plan',
    authorize: 'authenticated',
    envelope: 'participant',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated',     ['their_own:pii', 'their_own:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/programs/[id]/settings',
    authorize: 'program-lead-mentor',
    envelope: 'program',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/programs/[id]/volunteers',
    authorize: 'program-lead-mentor',
    envelope: 'assignment',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal',
                               'their_program_participants:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'DELETE /api/programs/[id]/volunteers',
    authorize: 'program-lead-mentor',
    envelope: 'assignment',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal',
                               'their_program_participants:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'PATCH /api/programs/[id]/volunteers',
    authorize: 'program-lead-mentor',
    envelope: 'assignment',
    orderedView: [
        ['sysadmin',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember',       ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['programLeadMentor', ['their_program_participants:pii',
                               'their_program_participants:personal',
                               'their_program_participants:internal', 'public']],
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
