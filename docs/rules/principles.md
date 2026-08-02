# Principles

Rules that no policy names but that are not a PR-level trade either. They sit
between the two tiers in every domain file: a change that violates one escalates
to the owner, not to the board, and not to whoever is reviewing that morning.

## What belongs here

The same test as any rule: **could a change violate it, and can you picture the
PR that gets it wrong?** "Least privilege" passes — a route requiring two roles
where one would do violates it. "Write clear code" does not.

Two further conditions, or it belongs in a domain file instead:

- **It is cross-cutting.** If it only ever bites in one domain, state it there.
  A principle earns its place here by saving the same sentence being written six
  times.
- **No policy names it.** Check the policy corpus before accepting that. A rule
  that turns out to be policy-backed is a Policy line with a citation, which
  carries more weight than anything here.

A domain file cites a principle the way it cites a policy —
`— *Principle: self-scope and repair*` — and states only what its domain adds on
top.

---

## Self-scope and repair

- **A person acts on their own records, and nobody else's.** Ownership is the
  default boundary for every write: your household, your enrollment, your visit,
  your profile.

- **Every state a person can reach is repairable by a superuser through the
  app.** Not by hand-editing the database. If the only way out of a state is a
  raw SQL update, the repair surface has not been built and the work is not
  finished.

  This is a build obligation, not a statement about permissions. Shipping a
  workflow means shipping the way back out of every state it can produce —
  the screen, the endpoint, and the audit row that goes with them. A feature
  that can strand someone is incomplete however well its happy path works.

*Which* superuser is not settled by this principle, and today it varies — some
surfaces admit the board and a sysadmin, others only the board. That inconsistency
is a live question, not an application of this rule.

The two halves are load-bearing together. Scope without repair produces states
nobody can fix; repair without scope is just an absence of access control.

---

## Decisions are reversible

Distinct from repair above: repair gets someone out of a state they are stuck
in, this puts back what a decision changed. Undoing restores what was there
before, not an approximation of it.

- **The cost of reversal scales with what the action destroys, and so does the
  obligation.** Flipping a flag back — member to non-member, paid to unpaid —
  needs nothing kept. An action that collapses structure has to capture the
  pre-image *before* it acts, because afterwards there is nothing left to read.

- **Merging two people is the hard case.** Two records become one and the second
  stops existing; without what they were, there is no undo, only a guess.

- **Reconstructing from the audit trail is a fallback, not a design.** Where the
  restore path has to infer what a row used to be from log entries, the decision
  was made without capturing what it destroyed. It works until a log is pruned or
  a shape changes.

- **Whether a record may be removed turns on two things: who points at it, and
  what it would be needed to prove.** *(Under review.)* Something other records
  refer to is kept and marked, because removing it breaks everything pointing at
  it. But a record nothing refers to may still have to be kept, where it is the
  evidence of a decision someone could later be answerable for — who a family
  said could collect their child is that; an enrollment is not.

  What is still open is where those lines sit, and whether capturing a whole
  record into the audit trail counts as capturing it or merely defers the same
  dependency. Only people are kept today; enrollments and visits are removed with
  the row written to the audit trail.

The tell is a status that swallows its predecessor — a row that goes to ARCHIVED
or MERGED with no record of what it was before. That is the moment to capture,
not the moment someone asks to undo.

---

## Least privilege

- **A surface is reachable by the narrowest set of roles that can do the work.**
  A role is not added to a gate because its holders are senior, because they
  already have a session, or because it is convenient — only because the work
  cannot be done without it.

- **Holding a role is not a reason to use it.** Where someone could act in more
  than one capacity, the narrower one governs; seniority is not an argument for
  reaching further.

Adding a role to a gate is the change this principle catches, and it is almost
never noticed in review, because it makes something work that did not work
before. Removing one is visible; widening is not.

---

## Fail closed

The same instinct as least privilege, at a different moment: least privilege
decides who gets a grant when the system is designed, this decides what happens
when the answer is not available at the time it is needed.

- **Missing or ambiguous data resolves to the more restrictive reading.** An
  absent date of birth means treat as a youth, not as an adult. Not knowing is
  never the permissive answer.

- **An unconfigured setting does not act.** A board setting that has not been set
  disables its feature; it never falls back to a guessed value. A number nobody
  chose is worse than a feature nobody turned on.

- **A check that cannot run has not passed.** An unreachable service, a failed
  lookup, a query returning nothing — none of these are a clearance.

- **Absent data is absent, not a zero.** A household with no membership has no
  member-since date, not one at the epoch; a person with no date of birth has no
  age, not age zero. Anything that reads, sorts, counts or renders such a value
  carries the difference through rather than flattening it.

The tell is a default. Every `?? 0`, `|| false`, and empty-result branch is this
principle being decided, usually without anyone noticing they decided it.

---

## No existence oracle

- **A response never reveals whether a person, account, or record exists to
  someone not entitled to know it.** This governs the shape of failures, not just
  successes: a distinct error message, a different status code, a slower reply, or
  a count that changes are all disclosures.

- **A helpful message is the usual way this breaks.** "That address already has an
  account" is friendlier and tells an unauthenticated caller that the address is
  registered. Where a caller is not entitled to the answer, failures are
  indistinguishable from one another.

This bites hardest on anything reachable without a session — registration,
lookups, password-adjacent flows — where the caller is by definition not entitled
to anything.

---

## Identity is not authorisation

Distinct from least privilege, which is about how much a grant covers. This is
about whether there is a grant at all: existing in the system is not permission
to do anything in it.

- **A surviving identifier is not a grant.** A session, a person id, a row that
  is still there — none of these authorise anything on their own. Where standing
  is withdrawn, everything that reads as authority has to be re-derived, not
  inferred from what is left behind.

- **A record that is no longer a person here holds nothing.** Merged away,
  tombstoned, denied, revoked — such a record appears in no roster, no headcount,
  no capacity calculation, and passes no gate.

The failure looks like a gate that tests the wrong thing: authorising on the
presence of an id rather than on a right the caller currently holds. It survives
review easily, because the check is right there and does return true for the
people it should.

---

## People decide about people

- **Automation classifies, warns, and escalates. It does not act on a person.**
  A job may mark someone overdue, send a reminder, and put them in front of the
  board. It does not remove them, revoke their standing, or withdraw what they
  hold.

- **A decision about someone is delivered by someone.** Approvals, denials and
  the consequences that follow are communicated by a person who can answer the
  reply. An automatic acknowledgement that a request arrived is not a decision
  and does not count.

The line is between a person's live standing and a request that has not become
one. A held seat expiring after a board-set grace is not a violation — nothing
was taken from anyone; an unpaid request simply stopped waiting. Removing an
active enrollment, or a member, is.

The temptation is always the same: the sweep already knows who is overdue, so
having it finish the job looks like an obvious improvement. It is the change
this principle exists to stop.

---

## This codebase is not this organisation

- **Our own particulars are inputs, not facts the software knows.** A date, a
  rate, a threshold or a name that this organisation chose is something someone
  can change without a deploy. When the membership year runs, what a membership
  costs, how long a background check stands — these are answers we hold, not
  truths built in.

- **This covers identity as much as values.** What the organisation is called and
  how it is branded are given to the software, not written inside it.

*Fail closed* governs what happens when one of these has not been set. This
governs whether it is a setting in the first place.

The tell is a literal sitting in domain code — a date, a threshold, a fee, a
name — that someone would have to edit and redeploy to change. The reason is not
engineering taste: other organisations may run parts of this, so anything true
only of us has to be something they can replace. Which also means the goal is not
reusability in the abstract, and this principle never asks for a plugin system.

---

## Accountability

- **Anything that changes standing, money, or access is attributable.** Who did
  it, when, what it changed from and to. This is not a per-feature courtesy: a
  new decision surface that writes no audit row is unfinished in the same way a
  missing repair path is.

- **A discretionary decision records why.** Where someone chose rather than
  followed a rule — an override, a comp, a certification, a denial — who and when
  is not enough to answer the question that gets asked later.

- **A system actor names itself.** A cron sweep, a webhook, or a migration writes
  its own identity, never an anonymous or borrowed one. "The system did it" is
  only an answer if the trail says which part of it.

- **A trail nobody can read is not a trail.** Being written is half of it; being
  retrievable by the person who has to answer for it is the other half.

The failure mode is not usually a missing log — it is a log that records the
happy path and goes quiet exactly where a human exercised judgement.
