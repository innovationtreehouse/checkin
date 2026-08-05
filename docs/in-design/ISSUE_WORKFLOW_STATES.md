# Issue workflow states — a forward-only ladder

## 1. Problem

The tracker's Status field is supposed to tell you, at a glance, what stage a
piece of work is at. It does not. Two pieces of work at completely different
stages — one where a proposal is being reviewed, one where the actual change is
being reviewed — show the same status, so the board cannot be read without
opening each item and working out which of the two it means.

The cause is that work which needs a written proposal first passes through
"under review" twice: once for the proposal, once for the change. Between those
two, it has to be moved *backwards* to an earlier stage. Anyone reading the
board mid-flight cannot tell whether an item is on its way up for the first time
or the second.

There is a second version of the same failure. Work that has been half
delivered — one part shipped, another part waiting on a release going out —
sits under a status meaning "free for anyone to pick up". It is not free. The
next person to pick it up finds out only by reading the whole history.

And four of the eight available statuses have never been written down anywhere.
Two of them hold most of the tracker's contents.

## 2. Objective

Status becomes a ladder each item climbs once. An item enters any state at most
once and never returns to one it has left. Reading the status alone tells you
what stage the work is at and who is expected to act next. Work that is not
actually available to pick up does not appear as available.

## 3. Executive summary

- **Nine statuses**, up from eight: the single "under review" status splits into
  **Design review** (a proposal is out for review) and **In review** (a change
  is out for review), and a new **Designing** sits alongside "In progress" as
  its proposal-stage twin. **Backlog** is retired — nothing has ever used it.
- **The common case gets no longer.** Work that needs no written proposal skips
  both new states: it climbs five rungs, exactly as it does today.
- **"Blocked" and "partly delivered" do not become statuses.** Blocked is a
  label, because it toggles and a ladder cannot have a rung you step off and
  back onto. Partly delivered is a decomposition problem: separately shippable
  parts become separate items, each climbing its own ladder once.
- **Cost:** two options added and one removed on the tracker by hand, a `blocked`
  label created, and roughly nine in-flight items re-filed onto the right rung.
  No tooling change, no automation change.
- **What is deliberately not solved:** one genuine backward move survives — work
  that has to be redone after its proposal or its change is abandoned. It is
  declared as a named exception rather than engineered away, because the only
  ways to remove it (re-file the item, or add a "was abandoned" state per leg)
  cost more than the ambiguity they buy back.

---

## 4. The states

Nine states. Seven progress rungs plus two terminals.

| # | State | An issue in this state is… | Assignee |
|---|---|---|---|
| 1 | **Ideation/Reporting** | filed, and nobody has yet decided the project will do it | none |
| 2 | **Planning** | one the project has decided to do, whose shape is not yet settled — scope, decomposition, and whether it needs a design doc are still open | none |
| 3 | **Designing** | one whose design doc is actively being written | the author |
| 4 | **Design review** | one whose design PR is open and awaiting review | none |
| 5 | **Ready** | shape-settled and unclaimed: its design is merged, or it never needed one, and it is free for anyone to pick up | none |
| 6 | **In progress** | one whose implementation is actively being written | the implementer |
| 7 | **In review** | one whose implementation PR is open and awaiting review | none |
| — | **Done** | shipped, and closed | none |
| — | **Rejected** | one the project has decided not to do, and closed | none |

Read the table as three pairs and a hinge. States 3/4 are the design leg
(writing, then reviewing). States 6/7 are the implementation leg (writing, then
reviewing). **Ready** is the hinge between them: the one state that means "the
design question is answered, whatever the answer was".

Two invariants make the states self-describing:

- **Odd rungs have an assignee, even rungs do not.** Precisely: exactly two
  states — Designing and In progress — carry an assignee, and they are the only
  two where a person is at a keyboard on this issue. Every other state is
  waiting on a decision, a reviewer, or nobody. An assignee is never a
  reservation.
- **Every state's exit is a public artifact**, not a judgement call: a PR opens,
  a PR merges, an issue closes. The two exceptions are Planning → Designing and
  Planning → Ready, which are a human deciding whether a design doc is needed.

### 4.1 Skipping is allowed; re-entry is not

The rule is monotonic, not exhaustive. An item may jump forward past any number
of rungs — a one-line bug fix picked up the moment it is filed goes
Ideation/Reporting → In progress in one move. What it may never do is enter a
state it has already left, or move to a lower-numbered one.

This is what lets the design leg exist without taxing work that does not need
it. Sections 6.4 and 6.5 trace both.

### 4.2 Rejected is reachable from anywhere

**Rejected** may be entered from any progress rung, including late ones —
deciding during implementation that the change should not ship is a normal
outcome. It is a terminal state, so entering it from rung 6 is not a backward
move.

### 4.3 Done is terminal — regressions are new issues

A closed item is never reopened. If shipped work turns out to be wrong,
that is a **new issue**, referencing the old one. This is what keeps Done
terminal rather than a rung with a back edge; the cost is that the tracker
does not thread a regression to its origin automatically, which a reference in
the body covers well enough.

---

## 5. Transitions

Every row moves forward. `→` reads "moves to".

| # | Event | From | To |
|---|---|---|---|
| T1 | Triage accepts the item — the project intends to do it | Ideation/Reporting | Planning |
| T2 | Scoping concludes a design doc is needed; an author takes it | Planning | **Designing** *(assign)* |
| T3 | Scoping concludes no design doc is needed | Planning | Ready |
| T4 | Design PR opens | Designing | **Design review** *(unassign)* |
| T5 | Design PR merges | Design review | Ready |
| T6 | Implementer picks the item up | Ready | In progress *(assign)* |
| T7 | Implementation PR opens, carrying a closing keyword | In progress | In review *(unassign)* |
| T8 | Implementation PR merges; closing keyword closes the issue | In review | Done *(automatic)* |
| T9 | The project decides not to do it | any progress rung | Rejected *(close)* |

Shortcut edges, all forward, all optional:

| # | Event | From | To |
|---|---|---|---|
| S1 | A filed item is picked up immediately, no scoping needed | Ideation/Reporting | Ready or In progress |
| S2 | An item's shape is settled and it is picked up in the same sitting | Planning | In progress |

### 5.1 What is *not* a transition

The three most common mistakes, stated so nobody "fixes" them by moving the
status backwards:

- **A reviewer requests changes.** The PR stays open; the status stays where it
  is (Design review or In review). The author pushing fixes is not a state
  change, and the issue stays unassigned throughout — the next action still
  belongs to reviewers.
- **A PR is retargeted, rebased, split, or stacked.** Mechanics of one leg, not
  a stage change.
- **A gate appears** — the work is now waiting on a release, an external party,
  or another issue. That is the `blocked` label (§7), not a status move.

### 5.2 The one exception: rework

Two situations genuinely reverse, and are declared rather than hidden.

| # | Event | From | To |
|---|---|---|---|
| X1 | A PR is closed unmerged and the work has to be redone | Design review → Designing, or In review → In progress | *(re-assign)* |
| X2 | Implementation shows the merged design is wrong | In progress or In review | Designing |

Both re-enter a state the issue has already occupied. **Both require a comment
on the issue saying what was abandoned and why** — that comment is what makes
the repeat legible, since the status alone can no longer distinguish the first
pass from the second.

Why they are not engineered away:

- Removing X1 means either re-filing the issue (which orphans its discussion,
  its parent link, and every PR reference to it) or adding per-leg "abandoned,
  retry" states — four more rungs to describe a case that is rare and already
  obvious from the closed PR.
- X2 is the same trade one rung earlier. A design that survives review and then
  fails contact with the code is a real event; pretending otherwise would push
  people to patch around a wrong design rather than reopen it, which is the
  worse outcome.

An exception that is written down and comment-gated is cheaper than four states
that exist to avoid admitting it.

---

## 6. Traces

Each trace lists the states in order. No state repeats in any of them.

### 6.1 #1258 — admin hour-correction review screen

Design PR #1497 is open and carries no closing link, as design PRs must not.
No implementation PR exists. Currently **In review**.

```
Ideation/Reporting → Planning → Designing → Design review ▸
```

**Now sits at: Design review.** The rest of the ladder — Ready → In progress →
In review → Done — is still ahead of it, and In review is a state it has not
yet entered.

Today, #1258 and #1396 both read "In review" while being four rungs apart. This
trace is the whole point of the split.

### 6.2 #1396 — merge transfers the background check date

The design doc has merged. Three implementation PRs are open (#1450, #1451,
#1470). Currently **In review**.

```
Ideation/Reporting → Planning → Designing → Design review → Ready → In progress → In review ▸
```

**Now sits at: In review** — the same words as today, but now they mean exactly
one thing, and the state is reached once.

**Finding, unrelated to the state model:** none of the three open PRs closes
#1396. `closingIssuesReferences` is empty on #1450 and #1451, and points to
#1260 on #1470. So nothing will close #1396 when they merge, and the automatic
T8 will not fire. Under §8 this item is really a **parent** whose children are
the three fixes; either give it sub-issues, or give one PR the closing keyword.

### 6.3 #975 — legacy two-variant Shopify shape

Design merged. Releases 0 and 1 shipped in PR #1464 (cleanup in #1493).
Release 2 — the `DROP COLUMN` migration — is outstanding and cannot start until
Release 1 is live in a **published prod release**; merging to `main` only
deploys dev. Currently **Ready**, which wrongly reads as "free to pick up".

Under the new model this is not one issue. It is a parent with two children,
split at the moment the design identified two separately deployable releases:

```
#975 (parent)   Ideation/Reporting → Planning → Designing → Design review → In progress ▸
  ├─ Release 0+1 (code)        Ready → In progress → In review → Done
  └─ Release 2 (DROP COLUMN)   Ready + `blocked` ▸
```

The parent skips Ready (T3/T5 straight into the implementation leg is a forward
jump; the parent is never picked up by a person, its children are). It sits in
**In progress** from the first child starting until the last child closes.

The child that is left carries the `blocked` label with its gate named in the
body: *"Release 1 live in a published prod release."* Someone scanning Ready
for work sees it greyed by the label rather than picking it up and discovering
the deploy hazard the hard way.

**Parent carve-out:** a parent issue has no assignee in In progress. The
assignee invariant in §4 applies to leaf issues; a parent is aggregate state,
which is what the tracker's existing Parent issue and Sub-issues progress
fields already express.

### 6.4 #1224 — individual agreement per adult child

Implementation PR #1477 is open with a confirmed closing link. Currently
**In review**.

```
Ideation/Reporting → Planning → Designing → Design review → Ready → In progress → In review ▸
```

Identical shape to #1396 — which is the point. Anything that went through a
design and is now in implementation review reads the same, and reads
differently from anything still in design review.

### 6.5 #1230 — "students ≥18 as of Sept 1" report

No design doc. Implementation PR #1495 is open and closes it. Currently
**In review**.

```
Ideation/Reporting → Planning → Ready → In progress → In review ▸
```

**Five rungs, not seven.** Designing and Design review are skipped entirely by
T3. The design leg costs work that does not need it exactly nothing — no state
to pass through, no field to set, no ceremony to perform. If it had been picked
up straight off the backlog it would be shorter still (S1).

---

## 7. Blocked and partly delivered

Both were candidates for new states. Both are rejected, for different reasons.

### 7.1 Blocked → a label

**Decision: a `blocked` repo label, with the gate named in the issue body.**

A status is a rung on a ladder. Blocked is not a rung — it is a property that
toggles on and off while the work stays exactly where it was. Modelling it as a
status forces Ready → Blocked → Ready, which is a re-entry, and breaks the one
guarantee this document exists to provide. There is no ordering of statuses that
fixes this, because being blocked is orthogonal to how far along the work is: an
item can be blocked in Planning, in Ready, or in In review, and unblocking
returns it to precisely where it was.

Labels already toggle freely, already filter on the board (`-label:blocked`
gives the pick-up-able view of Ready), and already exist. A dedicated "Blocked
by" field would carry the same information with more machinery and one more
thing to keep in sync.

The gate itself — *what* is blocking — goes in the issue body, not the label.
A label taxonomy of blocking reasons rots; a sentence does not.

### 7.2 Partly delivered → decomposition, not a state

**Decision: no state. Separately shippable parts become separate issues.**

A "Partially shipped" status cannot be monotonic for more than two releases: at
three releases the item enters it twice. More fundamentally, it hides the thing
that matters. "#975 is partly shipped" does not tell you what is left, what
gates it, or whether it is safe to start. "Release 2 — DROP COLUMN, blocked on a
prod release cut" tells you all three, and it is an ordinary leaf issue on an
ordinary ladder.

The trigger is easy to state: **if the design identifies more than one
separately deployable release, file one issue per release before the first one
starts.** #975 is the worked example — its design already names Release 0,
Release 1, and Release 2 as distinct deploys with an ordering constraint between
them. The decomposition was written; only the issues were not.

Trade accepted: the parent's status is coarse. It says "children are moving",
not which ones. The Sub-issues progress field already covers that, so the status
does not need to.

---

## 8. Mapping from the current options

| Current option | Items today | Becomes | Action |
|---|---|---|---|
| Ideation/Reporting | 140 | Ideation/Reporting | keep, definition tightened |
| Planning | 31 | Planning | keep, definition tightened |
| Backlog | **0** | — | **retire** |
| Ready | 1 | Ready | keep, narrowed to "design settled" |
| In progress | 1 | In progress | keep |
| In review | 9 | In review | keep, **narrowed to the implementation leg only** |
| Done | 27 | Done | keep |
| Rejected | **0** | Rejected | keep |
| — | — | **Designing** | **add** |
| — | — | **Design review** | **add** |

Counts are every item on the board (209 total).

**Backlog is retired on evidence, not taste.** In 209 items it has never been
used once; whatever it was meant to hold, Ideation/Reporting and Planning are
holding. An option nobody uses and nobody has documented is the exact defect
this document is fixing, so leaving it in place "just in case" reintroduces it.

**Rejected is kept despite also being empty**, because unlike Backlog it has a
definition that nothing else covers — see the open question in §10.

### 8.1 Manual steps (GitHub UI — none of this is scriptable safely)

Single-select option edits on a project are a UI action. Do them in this order:

1. **Add** option `Designing`.
2. **Add** option `Design review`.
3. **Reorder** the options to match the ladder: Ideation/Reporting, Planning,
   Designing, Design review, Ready, In progress, In review, Done, Rejected. The
   board reads left to right; monotonic status should be visibly monotonic.
4. **Delete** option `Backlog`. Confirm it is still at zero items first —
   deleting an option with items on it silently clears their status.
5. **Create** the `blocked` label in `innovationtreehouse/checkin`.
6. **Re-file the nine In review items** onto the correct rung: anything whose
   only open PR is a design PR moves to Design review (#1258 at minimum);
   everything else stays.
7. **Decompose #975** into parent + two children per §6.3, and label the
   Release 2 child `blocked`.

The built-in project workflows need no change. "Item closed" and "Pull request
merged" both drive Status → Done, and they fire only on a *linked* PR — a design
PR carries no closing keyword, so it cannot trigger them. That is why the
closing-keyword rule in §9 is load-bearing rather than a convention.

---

## 9. Proposed replacement for the AGENTS.md "Issue workflow" section

Replaces the section at `AGENTS.md` beginning `## Issue workflow (org project 1)`
in full. **Not applied by this doc.**

````markdown
## Issue workflow (org project 1)

Org **project 1** is the canonical triage surface. Its Status field is a
**forward-only ladder**: an issue enters each state at most once and never
returns to one it has left. Jumping *forward* past states is fine; re-entering
one is not. Status says what stage the work is at; the assignee says whether
someone is at a keyboard on it right now.

| Status | An issue here is… | Assignee |
|---|---|---|
| **Ideation/Reporting** | filed; nobody has decided we will do it | none |
| **Planning** | one we will do, whose shape isn't settled — scope, decomposition, and whether it needs a design doc | none |
| **Designing** | one whose design doc is being written | author |
| **Design review** | one whose design PR is open | none |
| **Ready** | shape settled — design merged, or none needed — and free to pick up | none |
| **In progress** | one whose implementation is being written | implementer |
| **In review** | one whose implementation PR is open | none |
| **Done** | shipped and closed | none |
| **Rejected** | one we've decided not to do, and closed | none |

**Design leg** = Designing → Design review. **Implementation leg** = In progress
→ In review. **Ready** is the hinge: it means the design question is answered,
whichever way. Work needing no design skips the design leg entirely.

**Assignment means one thing: someone is working it right now.** Only Designing
and In progress carry an assignee. Never leave one standing as a soft
reservation, and never trust it as the only claim signal.

- **Pick up**: choose an issue in **Ready** that is unassigned, has no `blocked`
  label, and has no open PR claiming it. The open-PR check is two-pronged,
  because design PRs create no closing link: (1) `closingIssuesReferences` on
  open PRs / the issue's Development panel, and (2) open PRs whose title or body
  mentions `#NNN` and carries a design doc for it. Assignment is dropped when a
  PR opens, so "unassigned" alone does not mean free. Then assign yourself and
  set Status → **In progress** (or **Designing**, if you're writing the design).
- **Re-verify before building**: issue bodies go stale — renames, moved files,
  callers added since filing. Re-run the blast-radius search against current
  `main` before implementing, and comment corrections on the issue (see #300:
  filed against `isMinor`/3 callers, fixed as `isYouth`/10 callers).
- **PR open**: **unassign the issue** and set Status by which leg the PR is on.
  The next action belongs to reviewers, not the author; a standing assignment
  would claim work that isn't happening.
  - **Design-doc PR** → Status **Design review**. Reference the issue WITHOUT a
    closing keyword (plain `#NNN`, "Design for #NNN"). A closing link here would
    auto-close the issue when the doc merges, with nothing implemented.
  - **Implementation PR** → Status **In review**. Use a closing keyword —
    `Fixes #NNN`, `Closes #NNN`, or `Resolves #NNN` — and confirm the link
    registered via `closingIssuesReferences`.
- **A reviewer requesting changes is not a state change.** The PR stays open,
  the status stays put, and the issue stays unassigned while the author revises.
- **Merge**: a merged design PR → set Status **Ready** for implementation
  pickup. A merged implementation PR needs nothing manual — the closing keyword
  closes the issue and the project's built-in workflows set Status → Done.
- **Blocked is a label, not a status.** Work that is waiting on a release, an
  external party, or another issue keeps its status and gains the `blocked`
  label, with the gate named in the issue body. Status tracks progress;
  blocking toggles, and a ladder can't have a rung you step off and back onto.
- **More than one deployable release = more than one issue.** If a design names
  separately deployable releases with an ordering constraint between them, file
  one issue per release before the first one starts, under a parent. A parent
  sits in **In progress**, unassigned, from its first child starting until its
  last child closes.
- **Done is terminal.** A regression in shipped work is a new issue referencing
  the old one, never a reopen.
- **Rework is the one backward move**, and it is comment-gated: if a PR is
  closed unmerged and the work must be redone, or implementation shows a merged
  design is wrong, move back to Designing / In progress **and comment on the
  issue saying what was abandoned and why**. The status can no longer tell the
  second pass from the first; that comment is what does.

Project-field writes need the `project` token scope; if GraphQL returns
INSUFFICIENT_SCOPES, have the user run `gh auth refresh -s project`.
````

---

## 10. Open questions

1. **Is Ideation/Reporting one bucket or two?** It holds 140 of 209 items —
    everything from a one-line report to an accepted-but-unscheduled epic. This
    proposal leaves it as one bucket and retires Backlog on the evidence that
    Backlog has never been used. The alternative reading is that Backlog is
    unused *because it was never documented*, and the real need is
    Reported (untriaged) → Backlog (accepted, unscheduled) → Planning
    (being scoped). That is one more rung, and it is a judgement about how the
    board is actually read day to day, which this analysis can't settle.

2. **Keep Rejected, or just close the issue?** It has zero items, so in practice
    unwanted work is being closed without it. Closing as "not planned" also
    trips the project's "Item closed" workflow into **Done**, which is wrong —
    Done should mean shipped. Either Rejected has to be set by hand *before*
    closing, or it should be dropped and Done redefined as "closed, however". Set
    by hand is the honest option; dropped is the lazy one. Needs a call.

3. **Should Designing require an assignee at all?** The invariant is clean, but
    a design doc is more often written by whoever is already in the area than
    claimed in advance. If designs are in practice unassigned, Designing and
    Design review collapse into one state and the ladder loses a rung — which
    would be an improvement, not a regression.

4. **Does the "no design needed" call ever get revisited?** T3 sends an item
    from Planning straight to Ready. If someone in Ready then decides a design
    *is* needed, that is Ready → Designing — a backward move not covered by X1
    or X2. Either it is a third exception, or the rule is that this decision is
    final once made and a mid-implementation design becomes X2. This proposal
    assumes the latter; worth confirming that matches how it actually goes.

5. **Renaming Ideation/Reporting.** The slash reads badly, but a rename touches
    140 items' worth of habit for no functional gain, so it is left alone here.
    Cosmetic call, not a blocker.

6. **Nothing enforces any of this.** The ladder is a convention checked by
    people, exactly like the current rules. A monotonicity check is buildable —
    walk each item's status-change timeline and flag any repeat or reversal —
    but it is not proposed, because the failure it catches is visible the moment
    anyone reads the board, and the exceptions in §5.2 mean it can never be a
    hard gate.

---

## Appendix — evidence

Status distribution across all 209 items on project 1:

| Status | Items |
|---|---|
| Ideation/Reporting | 140 |
| Planning | 31 |
| Done | 27 |
| In review | 9 |
| Ready | 1 |
| In progress | 1 |
| Backlog | 0 |
| Rejected | 0 |

Per-issue state used in §6, all open and on milestone v1.1, all unassigned:

| Issue | Status today | Open PRs | Closing link |
|---|---|---|---|
| #1258 | In review | #1497 (design) | none — correct for a design PR |
| #1396 | In review | #1450, #1451, #1470 | none to #1396; #1470 → #1260 |
| #975 | Ready | none | — (shipped via #1464, #1493) |
| #1224 | In review | #1477 | → #1224 |
| #1230 | In review | #1495 | → #1230 |

The #975 release gating is stated in
`checkin-app/docs/designs/975-LEGACY_VARIANT_CONTRACT.md`, section
"The deploy hazard (why the DROP is its own release)".
