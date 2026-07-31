/**
 * THE security policy. One entry per API endpoint and one per outbound surface.
 *
 * Every change here is a change to what data leaves the server, to which
 * role, through which channel. CODEOWNERS-gated, and boundary changes must
 * ship in their OWN PR (enforced by security-boundary-isolation.yml) so a
 * widening/narrowing is always an isolated, reviewable unit.
 *
 * This layer exists to make the policy easy to AUDIT — it is not a substitute
 * for careful route management. Handlers still owe tight selects and
 * deliberate response shapes; the stripper is the declared-policy backstop,
 * not the first line.
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

// Self-correction of the caller's OWN visit: PATCH edits the times, DELETE
// tombstones the row. Ownership is the admission gate — the route 404s any id
// that is not the caller's own live row — and their_own (Visit.personId) is the
// per-row backstop. The grant stops at 'personal' (arrivedAt/departedAt); the
// 'internal' tombstone fields stay stripped.
defineRoute({
    endpoint: 'PATCH /api/attendance/manual/[id]',
    authorize: 'self',
    envelope: 'visit',
    // Bag: { Visit }.
    returns: ['Visit'],
    orderedView: [
        ['authenticated', ['their_own:personal', 'member', 'public']],
    ],
});

defineRoute({
    endpoint: 'DELETE /api/attendance/manual/[id]',
    authorize: 'self',
    // No bag — the response is { success, flagged }, no model data.
    envelope: null,
    orderedView: [
        ['authenticated', ['their_own:personal', 'member', 'public']],
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
        // their_program_households:personal delivers the household band leads
        // operationally need — emergency contacts (personal). It deliberately
        // does NOT reach the family's home address or intake notes: address is
        // 'internal' and intakeNotes is 'pii', both outside a household-scoped
        // personal grant. EC yes, address no.
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

// Event roster — embeds participant contact pii (name/email/phone) AND
// personal-tier data (dob, incl. youth) for everyone enrolled in / RSVP'd to
// the program. This route is FAIL-CLOSED,
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
// directory's contact band (name[public]/email[pii]); dateOfBirth is 'personal'
// (the strict tier), so it reaches only sysadmin/board (everyones:personal) —
// a program lead may NOT enumerate the whole directory's DOBs. The UI degrades
// cleanly: the age-warning badge in the enroll picker needs dob, and only
// sysadmin/board can enroll anyway. FINDING for the CODEOWNERS reviewer:
// 'everyones:pii' here is a deliberate global-directory contact grant, not a
// per-program scope.
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

// Emergency board contact sheet for the front desk. Board email + phone to
// keyholders is DELIBERATE and owner-confirmed: a keyholder on shift needs to
// reach a board member, and this is the sheet they reach for. That makes the
// 'pii' grant an operational one exactly as core.ts describes it ("routinely
// grantable to operational roles: program leads, keyholders"), not a leak.
// Declared here so the recurring audit finding on this route resolves to
// policy instead of being re-litigated each sweep — same move as
// GET /api/shop/certifications below.
//
// Written as 'keyholders:pii' (bound flag-only on Person) rather than
// 'everyones:pii' so the grant reads as what it is. Both resolve identically
// under this route's role gate; the token is the audit signal.
//
// The route's Prisma select stays tight (id/name/email/phone) as defense in
// depth: dateOfBirth and googleId are 'personal'/'pii' on Person and must
// never enter this response even for sysadmin.
//
// Landed registry-first, ahead of the route's handler() migration, per the
// AGENTS.md boundary-isolation rule: an unused defineRoute is inert, so the
// grant is reviewable on its own before anything serves it.
defineRoute({
    endpoint: 'GET /api/safety/board-contacts',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember', 'isKeyholder'] },
    envelope: 'members',
    // Bag: { Person }.
    returns: ['Person'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isKeyholder',   ['keyholders:pii', 'member', 'public']],
    ],
});

// Board's in-flight membership applications. Exposes every applicant household's
// PII (parents + children names/emails), so only isSysadmin/board may see it, and
// the field grant is explicit per role.
defineRoute({
    endpoint: 'GET /api/membership-ops/applications',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: 'processes',
    // Bag: { OrgMembershipProcess } with attestations (BackgroundCheckAttestation),
    // membership (OrgMembership → household Household → householdMembers Person,
    // leads flagged isHouseholdLead).
    returns: ['OrgMembershipProcess', 'BackgroundCheckAttestation', 'OrgMembership', 'Household', 'Person'],
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
    // Bag: { OrgMembershipProcess } with membership (OrgMembership → household Household
    // → householdMembers Person, leads flagged isHouseholdLead).
    returns: ['OrgMembershipProcess', 'OrgMembership', 'Household', 'Person'],
    orderedView: [
        ['isBackgroundCheckReviewer', ['everyones:pii', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'member', 'public']],
    ],
});

// The caller's household trusted adults. Household-scoped: members/leads see
// the family context (internal — narrative safeguarding band; the family
// authored it and the renew form prefills it) + the adult's contact + the
// board's shared note (personal) + status/dates. The their_households:internal
// grant nominally also covers TrustedAdultReview.decision/decisionNote (the
// board's private notes) — those are kept out by the handler's SELECT, which
// is pinned by trustedAdultAPI.integration.test.ts ("the family sees
// familyContext + the board shared note, not internal fields"). Do not widen
// that select.
defineRoute({
    endpoint: 'GET /api/trusted-adults/mine',
    authorize: 'household-member',
    envelope: 'trustedAdults',
    // Bag: { TrustedAdult } with reviews (TrustedAdultReview).
    returns: ['TrustedAdult', 'TrustedAdultReview'],
    orderedView: [
        ['authenticated', ['their_households:pii', 'their_households:personal', 'their_households:internal', 'member', 'public']],
    ],
});

// Board's trusted-adult review queue. Full visibility incl. familyContext
// (internal — narrative band) and the board's internal decision notes.
defineRoute({
    endpoint: 'GET /api/safety/trusted-adults',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: 'trustedAdults',
    // Bag: { TrustedAdult } with household (Household → householdMembers Person,
    // leads flagged isHouseholdLead), trustedAdultPerson (Person), reviews (TrustedAdultReview).
    returns: ['TrustedAdult', 'Household', 'Person', 'TrustedAdultReview'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Operational pickup view for keyholders (global) and program leads (the
// households whose kids they oversee). They get the board's shared note + the
// adult's name/contact (personal), but NOT the family's board-facing context
// or the board's internal notes (both internal — the strict narrative band
// their personal-only grants never reach). Household address is also internal,
// so the nested Household rows expose name only. The handler restricts which
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
// with the full participant + program nested, plus the participant's
// household/orgMembership (so the board can see CURRENT membership while
// deciding — wasOrgMemberAtApproval is only stamped on approval). Board/sysadmin
// only, and they hold everyones:* so they see every field — the win is the
// declared policy: any role later added to this view is field-stripped
// automatically.
defineRoute({
    endpoint: 'GET /api/finance-ops/payment-plans',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: null,
    returns: ['ProgramParticipant', 'Person', 'Program', 'Household', 'OrgMembership', 'BoardSettings'],
    orderedView: [
        ['isSysadmin',    ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
        ['isBoardMember', ['everyones:pii', 'everyones:personal', 'everyones:internal', 'member', 'public']],
    ],
});

// Board's membership payment-plan approval queue. Returns PENDING_PAYMENT
// OrgMembershipProcess rows the household asked to pay by plan, with the
// membership + household nested. Board/sysadmin only, and they hold everyones:*
// so they see every field — the win is the declared policy: any role later added
// to this view is field-stripped automatically.
defineRoute({
    endpoint: 'GET /api/finance-ops/membership-payment-plans',
    authorize: { anyRole: ['isSysadmin', 'isBoardMember'] },
    envelope: null,
    returns: ['OrgMembershipProcess', 'OrgMembership', 'Household'],
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
    endpoint: 'GET /api/shop/org-members',
    authorize: 'certifier',
    // bag-key `Person` (model driving field-strip) vs envelope `orgMembers` (camelCase JSON key) vs path `org-members` (kebab URL) — divergence intentional.
    envelope: 'orgMembers',
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
