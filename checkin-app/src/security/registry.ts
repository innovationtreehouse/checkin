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
    // Bag: { Person } with nested visits (Visit) → event (Event).
    returns: ['Person', 'Visit', 'Event'],
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
    // Bag: { Program } with volunteers (ProgramVolunteer → participant Person),
    // participants (ProgramParticipant → participant Person → household Household
    // → emergencyContacts EmergencyContact), events (Event), fees (Fee), leadMentor
    // (Person).
    returns: ['Program', 'ProgramParticipant', 'ProgramVolunteer', 'Person', 'Household', 'EmergencyContact', 'Event', 'Fee'],
    orderedView: [
        ['isSysadmin',             ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember',          ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['programLeadMentor',    ['their_program_participants:pii',
                                  'their_program_participants:personal',
                                  'their_program_households:personal',
                                  'member', 'public']],
        ['programCoreVolunteer', ['their_program_participants:pii',
                                  'their_program_participants:personal',
                                  'their_program_households:personal',
                                  'member', 'public']],
        ['authenticated',        ['their_own:pii', 'their_own:personal', 'member', 'public']],
        ['anyone',               ['public']],
    ],
});

// Event roster — embeds participant PII (name/email/phone/dob, incl. youth) for
// everyone enrolled in / RSVP'd to the program. This route is FAIL-CLOSED,
// staff-only: the handler fn (events/[id]/route.ts) does an inline event->program
// lead/core-vol/admin gate and throws 403 for everyone else, so non-staff never
// receive the roster at all. That gate is NOT here in `authorize` because the
// roster's identities (name/id, and the existence of each enrollment/RSVP/Visit
// row) are tier 'public', so per-field stripping cannot hide the "who attends"
// association — only admission can; and the event->program check can't be
// expressed in the program-scoped `authorize` grammar (this [id] is an EVENT id;
// resolveAccess keys those on a PROGRAM id). The orderedView below is therefore
// defense-in-depth over the staff tiers only: admin -> everyones:*, and this
// event's lead/core-vol -> their_program_participants:* via the per-row scope
// resolver (mirrors 'GET /api/trusted-adults/operational'). internal tier is
// granted to that scope so staff keep attendanceConfirmedAt (rendered by
// program-ops/sessions/[id]).
defineRoute({
    endpoint: 'GET /api/events/[id]',
    authorize: 'authenticated',
    envelope: null,
    // Bag: { Event } with program (Program → volunteers ProgramVolunteer → participant
    // Person; participants ProgramParticipant → participant Person), visits
    // (Visit), rsvps (RSVP → participant Person), attendanceConfirmedBy (Person).
    returns: ['Event', 'Program', 'ProgramVolunteer', 'ProgramParticipant', 'Person', 'Visit', 'RSVP'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['authenticated', ['their_program_participants:pii',
                           'their_program_participants:personal',
                           'their_program_participants:internal',
                           'their_own:pii',
                           'their_own:personal',
                           'member', 'public']],
    ],
});

// Staff directory SEARCH for un-enrolled participants to add to a program. The
// rows are NOT in the program (by definition), so the per-row
// their_program_participants scope grants nothing here — admission is the real
// boundary: 'program-lead-mentor' (resolveAccess also admits sysadmin/board)
// restricts callers to a lead of THIS program. Once admitted, staff see the
// directory's pii (name[public]/email[pii]/dateOfBirth[pii]) — preserving the
// old inline behavior, which already ran a global participant query. So the
// admitted views carry 'everyones:pii'. FINDING for the CODEOWNERS reviewer:
// this is a deliberate global-directory grant, not a per-program scope.
defineRoute({
    endpoint: 'GET /api/programs/[id]/eligible-participants',
    authorize: 'program-lead-mentor',
    envelope: 'members',
    // Bag: { Person }.
    returns: ['Person'],
    orderedView: [
        ['isSysadmin',        ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember',     ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['programLeadMentor', ['everyones:pii', 'member', 'public']],
    ],
});

defineRoute({
    endpoint: 'GET /api/directory/board',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember', 'isKeyholder'] },
    envelope: 'boardMembers',
    // Bag: { Person }.
    returns: ['Person'],
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
    // Bag: { MembershipProcess } with attestations (BackgroundCheckAttestation),
    // membership (Membership → household Household → participants Person,
    // leads HouseholdLead).
    returns: ['MembershipProcess', 'BackgroundCheckAttestation', 'Membership', 'Household', 'Person', 'HouseholdLead'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Background-check reviewers' queue. Reviewers must see applicant parents' names
// + emails (to look them up on Averity) but NOT internal/personal fields — so the
// grant is deliberately limited to pii + public. Board members are implicit
// reviewers (canReviewBackgroundChecks) and get the same limited band.
defineRoute({
    endpoint: 'GET /api/membership/reviews',
    authorize: { anyRole: ['isBackgroundCheckReviewer', 'isBoardMember'] },
    envelope: 'queue',
    // Bag: { MembershipProcess } with membership (Membership → household Household
    // → leads HouseholdLead → participant Person).
    returns: ['MembershipProcess', 'Membership', 'Household', 'HouseholdLead', 'Person'],
    orderedView: [
        ['isBackgroundCheckReviewer', ['everyones:pii', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'member', 'public']],
    ],
});

// The caller's household trusted adults. Household-scoped: members/leads see the
// family context (pii band) + the board's shared note (personal) + status/dates,
// but never the board's internal decision notes.
defineRoute({
    endpoint: 'GET /api/trusted-adults/mine',
    authorize: 'household-member',
    envelope: 'trustedAdults',
    // Bag: { TrustedAdult } with reviews (TrustedAdultReview).
    returns: ['TrustedAdult', 'TrustedAdultReview'],
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
    // Bag: { TrustedAdult } with household (Household → leads HouseholdLead →
    // participant Person), trustedAdultPerson (Person), reviews (TrustedAdultReview).
    returns: ['TrustedAdult', 'Household', 'HouseholdLead', 'Person', 'TrustedAdultReview'],
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
    // Bag: { TrustedAdult } with household (Household), reviews (TrustedAdultReview).
    returns: ['TrustedAdult', 'Household', 'TrustedAdultReview'],
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

// Board's payment-plan approval queue. Returns pending ProgramParticipant rows
// with the full participant + program nested. Board/sysadmin only, and they hold
// everyones:* so they see every field — the win is the declared policy: any role
// later added to this view is field-stripped automatically.
defineRoute({
    endpoint: 'GET /api/finance-ops/payment-plans',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: null,
    returns: ['ProgramParticipant', 'Person', 'Program'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Shop member roster (for certifying tools). Admins/board see the full row incl.
// email (pii). Certifiers only need to NAME the member they certify, so they get
// name (public) + member-tier — NOT everyones:pii. This deliberately TIGHTENS the
// pre-migration behavior, which leaked every member's email to any certifier.
defineRoute({
    endpoint: 'GET /api/shop/members',
    authorize: 'certifier',
    envelope: 'members',
    returns: ['Person'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['certifier',     ['member', 'public']],
    ],
});

// Shop tool certifications. PUBLIC BY DESIGN — cert status is physically posted
// in the shop, so any authenticated member may read who is certified on what
// (participantId/toolId/name = public, level = member tier). Admission is
// 'authenticated' (a logged-in member; denied households fail closed at
// authenticateRequest). The route selects only {id, name} (no client needs
// email), but this policy declares participant email as staff-only: if email is
// ever added to the select, only the staff view (everyones:pii) receives it;
// certifiers and members match 'authenticated' and see name + level only. This
// makes the endpoint's public intent machine-readable, so the recurring
// IDOR-shaped audit false-positive resolves to declared policy.
defineRoute({
    endpoint: 'GET /api/shop/certifications',
    authorize: 'authenticated',
    envelope: null,
    // Bag: { ToolStatus } with tool (Tool) and participant (Person).
    returns: ['ToolStatus', 'Tool', 'Person'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['authenticated', ['member', 'public']],
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
