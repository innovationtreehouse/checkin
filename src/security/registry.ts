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
    // Returns 30 days of {date, count, p50, p90, p99} scan-latency buckets computed from SystemMetric — aggregated stats, no row data leaves.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/admin/trends',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: null,
    orderedView: [],
    // Returns period buckets (uniqueVolunteers/uniqueStudents/totalHours/etc.) computed from Visit + Participant joins — counts and sums, no row data leaves.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'POST /api/admin/participants/import',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: null,
    orderedView: [],
    // Returns {success, message, errors[]} after bulk xlsx import — operational summary of inserts/updates, not row data.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'POST /api/admin/participants/import/preview',
    authorize: { anyRole: ['sysadmin', 'boardMember'] },
    envelope: null,
    orderedView: [],
    // Returns parsed xlsx preview {columns, rows: {data, status, action, warnings}, summary} — derived from uploaded file, not DB rows. Includes admin's own uploaded data only.
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
    envelope: null,
    orderedView: [],
    // Write-only ack: returns {household: <just-created household>} for
    // the caller's own create. The session's householdId hasn't been
    // refreshed yet within this request, so the stripper's
    // `their_households` scope can't recognize the row as the caller's
    // own — without this bypass, the id (personal) and name/address (pii)
    // get stripped out of the response to the very user who just created
    // them. The handler gates creation on the caller having no existing
    // household and connects them as participant + lead, so the returned
    // row is by construction owned by the caller.
    dangerously_allow_all_data_access: true,
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
    // Returns {success: true} after persisting the caller's own phone/emergency-contact fields — write-only ack, no row data leaves.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/profile/onboarding-status',
    authorize: 'self',
    envelope: null,
    orderedView: [],
    // Returns onboarding-completion booleans (needsPhone, isLead, needsEmergencyContact) plus the caller's own phone + emergency-contact scalars. authorize: 'self' is the gate; values come from the caller's own Participant/Household row.
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
    // Returns {participants: [{id, email, name, shopSteward, toolStatuses, ageCategory}], tools} — Participant rows augmented with a computed ageCategory derived from dob (which is dropped from the response). Kiosk + session auth grants identical view; no role-tier mapping available, so the stripper would have no scope to apply.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/kiosk/version',
    authorize: 'public',
    envelope: null,
    orderedView: [],
    // Returns {version: gitSha} — process-level metadata for cache-busting kiosk clients. No DB access.
    dangerously_allow_all_data_access: true,
});

// ─── Health ────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/health',
    authorize: 'public',
    envelope: null,
    orderedView: [['anyone', ['public']]],
    // Returns {status: "ok"} — liveness probe, no DB access, no row data.
    dangerously_allow_all_data_access: true,
});

// ─── Events ────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'POST /api/events',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [],
    // Returns {count: n} from createMany after generating 1..N events from a recurrence rule — operational write summary, no row data leaves. (Returning the inserted rows would require N findUniques after createMany since Prisma createMany doesn't return rows on Postgres.)
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
    // Multi-shape: returns {Event} for single-row edits, {count} for bulk recurring-group edits/cancels, or {success} for single-row cancels. Shape varies by body.action (editTime/cancel/confirmAttendance/manualEditAttendance); the per-action row-level role check is handler-internal.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'POST /api/events/[id]/attendance',
    authorize: 'authenticated',
    envelope: null,
    orderedView: [],
    // Returns {processed: count} after bulk validating attendance for an array of participantIds — operational write summary, no row data leaves. Per-event lead-mentor/admin gate is handler-internal.
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
    // Multi-shape envelope: {access: "full", attendance, counts, safety, signedRequest} for admin/kiosk; {access: "limited", counts, safety, self, household, signedRequest} for everyone else. Per-role filtering happens in-handler (selfVisit / household scope) rather than via the stripper.
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
    // Multi-shape: {Visit} for MANUAL_CHECKIN; {notified: count} or {success: false, message} for TWO_DEEP_VIOLATION board-notification. Shape varies by body.type, and the violation branch returns operational notify counts, not row data.
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

// ─── Shop ──────────────────────────────────────────────────────────────────

defineRoute({
    endpoint: 'GET /api/shop/active',
    // Admits any session; the handler also lets users with a
    // MAY_CERTIFY_OTHERS tool status through alongside shopSteward / admin.
    // The framework has no per-tool certifier role so the check is local.
    authorize: 'authenticated',
    envelope: 'occupants',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['shopSteward', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/shop/certifications',
    authorize: 'authenticated',
    envelope: 'certifications',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['shopSteward', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal', 'their_own:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/shop/certifications',
    authorize: 'authenticated',
    envelope: 'certification',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['shopSteward', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['their_own:pii', 'their_own:personal', 'their_own:internal', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/shop/members',
    authorize: 'authenticated',
    envelope: 'members',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['shopSteward', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/shop/tools',
    authorize: 'authenticated',
    envelope: 'tools',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['shopSteward', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['authenticated', ['public']],
    ],
});

defineRoute({
    endpoint: 'POST /api/shop/tools',
    authorize: { anyRole: ['sysadmin', 'boardMember', 'shopSteward'] },
    envelope: 'tool',
    orderedView: [
        ['sysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['boardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
        ['shopSteward', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'public']],
    ],
});

// ─── Cron jobs (Bearer CRON_SECRET) ────────────────────────────────────────
// Operational endpoints invoked by Vercel Cron / CloudWatch Events. They
// return aggregated counts/markers, not model rows, so the stripper is
// bypassed; `authorize: 'cron'` (timing-safe Bearer check) is the only gate.

defineRoute({
    endpoint: 'GET /api/cron/nightly',
    authorize: 'cron',
    envelope: null,
    orderedView: [],
    // Returns {success, facilityClose: {checkedOutCount, boardNotified}, postEvents: {...}} — operational summary of facility-close + post-event email batches. Consumed by Vercel Cron, never a human.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/cron/pending-participants',
    authorize: 'cron',
    envelope: null,
    orderedView: [],
    // Returns {success, processed, kicked, warned} — counts of pending-status participants kicked/warned for stale enrollments. Operational, no row data.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/cron/post-event',
    authorize: 'cron',
    envelope: null,
    orderedView: [],
    // Returns {success, ...emailResult} from processPostEventEmails — counts of post-event emails sent. Operational, no row data.
    dangerously_allow_all_data_access: true,
});

defineRoute({
    endpoint: 'GET /api/cron/reminders',
    authorize: 'cron',
    envelope: null,
    orderedView: [],
    // Returns {success, processedEvents, notificationsSent} — counts of upcoming-event reminder notifications fired. Operational, no row data.
    dangerously_allow_all_data_access: true,
});

// ─── Dev personas (dev-login picker) ───────────────────────────────────────
// `dev-only` gate passes iff NEXT_PUBLIC_DEV_AUTH is set. The list of
// @example.com personas is dev-tooling, never shipped to prod, so the
// stripper is bypassed.

defineRoute({
    endpoint: 'GET /api/auth/dev-personas',
    authorize: 'dev-only',
    envelope: 'personas',
    orderedView: [],
    // Returns @example.com Participant rows joined with ToolStatus levels — mixed-model shape used by the dev login picker. Gated by NEXT_PUBLIC_DEV_AUTH; never reachable in production builds.
    dangerously_allow_all_data_access: true,
});

// ─── Public program registration (self-serve enrollment) ──────────────────
// Anyone can enroll their household into a program by POSTing this form;
// downstream we may hand them a Shopify checkout URL. Response shape is
// `{ success, isFree, checkoutUrl, message }` — not model rows — so the
// stripper is bypassed.

defineRoute({
    endpoint: 'POST /api/programs/[id]/public-register',
    authorize: 'public',
    envelope: null,
    orderedView: [],
    // Returns {success, isFree, checkoutUrl, message} — registration ack with optional Shopify redirect URL. Submitter sees only data they just typed (their own form). No DB rows leave.
    dangerously_allow_all_data_access: true,
});

// ─── Scan (kiosk OR session) ───────────────────────────────────────────────
// Kiosk badge readers and authenticated web sessions both POST here. The
// `anyOf` gate runs HMAC verification when an x-kiosk-signature header is
// present (rawBody is consumed there) and falls through to the session
// auth check otherwise. Response shape varies (checkin/checkout/warning)
// and is computed from multiple models, so the stripper is bypassed.

defineRoute({
    endpoint: 'POST /api/scan',
    authorize: { anyOf: ['kiosk', 'authenticated'] },
    envelope: null,
    orderedView: [],
    // Multi-shape: returns {type: 'checkin' | 'checkout' | 'warning' | 'ignored_debounce', ...} computed across Participant/Visit/Event — branches in processCheckin/processCheckout return per-event payloads with display strings, not raw rows.
    dangerously_allow_all_data_access: true,
});

// ─── Webhooks ──────────────────────────────────────────────────────────────
// Shopify posts order events here. HMAC-SHA256 over the raw body using
// SHOPIFY_WEBHOOK_SECRET is verified by the framework. Response is a
// simple `{ success: true }` acknowledgement.

defineRoute({
    endpoint: 'POST /api/webhooks/shopify',
    authorize: { webhook: 'shopify' },
    envelope: null,
    orderedView: [],
    // Returns {success: true} — Shopify-required 200 acknowledgement after HMAC verification. No DB rows leave.
    dangerously_allow_all_data_access: true,
});

// ─── Outbound surfaces ─────────────────────────────────────────────────────

defineOutbound({
    surface: 'shopify.product.create',
    // Program name + prices + maxParticipants — all 'public' tier.
    tiers: ['public'],
});

defineOutbound({
    surface: 'shopify.checkout-url',
    // No request body crosses the network — we hand a URL to the client
    // who then redirects. The participant + program IDs travel embedded
    // in that URL (query string), so we route through outboundCall() to
    // surface the egress in the policy. program.id /
    // shopifyNonMemberVariantId are 'public'; participant.id is 'pii'.
    tiers: ['public', 'pii'],
});

defineOutbound({
    surface: 'email.admin-notify',
    // Email address is 'pii' tier; the address is the entire payload here.
    tiers: ['public', 'pii'],
});
