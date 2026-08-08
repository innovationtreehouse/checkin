# Engineering conventions

How we build, as distinct from what the domain requires. Nothing here is a
statement about membership, programs, or people — those live in `docs/rules/`,
and a reviewer checking a domain change does not need this file.

A convention earns a place here the same way a rule does: a change could violate
it, and you can picture the change that does.

---

## The server decides, the client mirrors

- **Anything affecting price, access, or eligibility is computed on the server.**
  A value the client asserts about itself — a membership tier, a role, a
  discount — is an input to be re-derived, never a fact to act on.

- **Where the interface hides or disables a control, it does so on the same rule
  the server enforces.** The two are written against one source so they cannot
  drift, and the client's version is a convenience, never the gate. A control
  that is merely hidden is not protected.

The failure is a gate that exists only in the interface. It looks correct in
every screenshot and every manual test, because the button is not there — and
the endpoint behind it answers anyone who asks.

---

## We do not write addresses at domains we do not own

- **Any address the app generates uses a domain the organisation controls, or a
  reserved non-routable one.** This holds for addresses nobody will ever read —
  a tombstone on a merged record still resolves somewhere, and somewhere is
  someone else's mail server.

A domain choice is invisible in review. A plausible-looking name is registrable
by anyone, and the mistake is only visible to whoever owns it.

---

## An invariant everyone must remember is not an invariant

- **Where something must never be read, make it impossible to read rather than
  everyone's job to exclude.** A rule held by convention holds until the first
  person who has not read the convention writes a query.

- **A filter every caller must remember, a guard that hunts for the ones who
  forgot, and a list of justified exceptions are one smell, not three.** That
  arrangement is how a design announces it needs the invariant moved into the
  data rather than reasserted at each site.

The failure is silent by construction. Forgetting produces no error, no failed
test and no wrong-looking code — just a row that should not have been there,
counted, rendered, or accepted as proof of who someone is. It is found when
someone notices the number is wrong, which is not a mechanism.

---

## We name the role, not the vendor

- **A rule that governs agents says "agent", never a product name.** More than
  one works in this repo: `AGENTS.md` is the shared contract, and `CLAUDE.md`,
  `GEMINI.md` and `.jules/sentinel.md` carry what is specific to each. A
  convention written against one product binds that product alone — every other
  agent is exempt from it while appearing to be covered.

- **Where an artifact records which agent produced it, the agent supplies its
  own name.** The rule fixes the field, not the answer. "Ends with a line naming
  the agent" is a rule; "ends with `Posted by <product>`" is that product's
  configuration written into everyone's rulebook.

- **Product-specific detail belongs in that product's own instruction file** —
  where a reader already looks for it, and where it can be deleted along with
  the tool.

This does not reach *records* of work already done. A comment that says which
agent wrote it is a fact about that comment and stays true; the convention
governs the rule, not the audit trail it produced.

The failure is a rule that looks universal and is not. It reads as satisfied,
because the named product does obey it and reviewers watch it obey — while the
same work done by any other agent is silently unbound. It surfaces when the
lineup changes, and the convention turns out to have described a vendor rather
than a practice.

---

## A check that costs money is not a health check

- **A dependency billed per wake is read when a person asks for it, never on a
  schedule and never on a render.** The store mirror sleeps when idle and is
  charged for waking; that is why its catch-up runs on a cadence rather than
  continuously, and why its diagnostics and audit reports sit behind a button.

- **An always-on indicator reports whether something is configured, never
  whether it answers.** Turning a presence check into a live one puts a paid
  call behind every page load, and the badge that polls it makes that per
  visitor per minute.

The change that breaks this reads as an improvement. "The dashboard only says
the integration is configured — let's make it actually check" is better by every
measure a reviewer can see in the diff. Nothing fails, no test bills, and the
cost arrives a month later attached to no particular change.

---

## A day is not a moment

- **Every temporal field is one kind or the other, and the column type says
  which.** A moment is a point on the timeline: a visit arrival, an event's
  start, an audit stamp. A day has no time and no zone: a date of birth, a
  program's start and end, a membership's start, a background-check day, the
  membership-year boundary. Days are stored as a database `date`, so the
  classification survives a writer who has never read this file.

- **A day is read, rendered and aged without a zone.** Putting a wall-clock zone
  on one yields the day before for every reader west of it, and an age taken from
  its local fields flips on the person's own birthday.

- **A moment is displayed in the zone the organisation configured**, never one
  compiled in. The exception is a native local-time input, which is local to
  whoever is typing in it by definition.
  — *Principle: this codebase is not this organisation*

- **A day is never taken from a moment.** Keeping the date part of "now" answers
  in whatever zone the process happens to be running in; a day comes from a day.
  When "today" genuinely is the question — an age as of now — name the zone that
  decides it: `orgCalendarDay()` in `lib/time.ts` is the one seam that turns an
  instant into a day, and every caller downstream of it works in days.

Nothing in the type system separates the two: both are a date object in the code,
and in a UTC test environment both are right. The failure appears later as a
birthday rendered a day early, an age gate that turns someone away on the morning
they qualify, or a second record for a person because a lookup by exact date
missed a row stored at a different time of day.
