# Intake field profiles — the single source of truth for "what does each intake ask"

`profiles.ts` is the **authoritative registry** of which fields each intake
surface shows and requires. It exists to stop a bug we already lived through:
four different intake forms each hand-rolled their own field list + validation,
and they drifted apart (allergies present in edit forms but not create forms;
parent phone required in one surface, absent in another, optional in a third).

**The rule:** an intake surface declares its context and reads its shown/required
fields from a profile here. It does **not** hard-code a field list or re-derive
"required at submit" inline. Add or rename an intake field in **one place** — a
profile — and every surface inherits it.

## The surfaces and their contexts

`INTAKE_PROFILES` defines two context profiles today:

| Surface | Context profile | Writes via |
|---|---|---|
| Membership "Join the Treehouse" (initial) | `membership-initial` | `saveIntake` + `submitIntake` (advances the OrgMembershipProcess) |
| First-time program registration (auth-first) | `program-first-time` | `saveIntake` only — **no** membership process |

Other intake surfaces have no profile of their own: household self-service
(`/api/household/intake`) reuses `saveIntake` as a context-free save with no submit gate;
membership renewal does not go through the intake service at all (`renewal.ts`).

New surface? Add a context + profile here first; don't invent a parallel form.

## How the pieces fit

- **`profiles.ts`** — declares, per context: which fields are *shown* and which
  are *required at submit*. This is the only place required-ness lives.
- **`saveIntake` / `getIntakeState`** (`src/lib/membership/intake.ts`) — the one
  write/prefill service for household + person + emergency-contact rows.
  Resumable, never-deletes, lead-scoped, honors the household-lead cap, runs the
  emergency-contact not-a-member reconcile. It is **context-free**: it does *not*
  create or advance an `OrgMembershipProcess` (that's `startIntake`/`submitIntake`).
  A non-membership surface (e.g. program registration) calls `saveIntake`
  directly and never touches a membership process.
- **Shared form components** (`src/components/membership/AddressForm`,
  `ChildrenListForm`, `EmergencyContactForm`) — reuse these; don't rebuild inputs.

## Do / don't

- **Do** validate a submit against `profile.requiredAtSubmit`, and render
  `profile.shown`. Membership's `submitIntake` already works this way — follow it.
- **Do** enforce context-specific rules the registry can't express at the right
  layer (e.g. program registration requires a participant's DOB only when the
  target program is age-gated — that's enforced by the enroll step's
  `enrollBlock` + the participants route, not by the profile).
- **Don't** add a field to one form's JSX + one route's body without adding it to
  the profile — that's exactly how the surfaces diverged before.
- **Don't** call `startIntake`/`submitIntake` from a non-membership surface.

## History

This registry was extracted from the auth-first program-registration work; the old
anonymous `public-register` form was the poorest of the four intakes and was removed.
