# Issue workflow states — a forward-only ladder

## 1. Problem

The tracker's Status is supposed to say what stage a piece of work is at. It
does not. Work where a written proposal is out for review and work where the
actual change is out for review show the same status, so the board cannot be
read without opening each item to find out which one it means. Getting from the
first to the second requires moving the item *backwards*.

Work that is half delivered — one part shipped, the rest waiting on a release
going out — sits under a status meaning "free for anyone to pick up". It is not.

Four of the eight available statuses have never been written down. Two of them
hold most of the tracker's contents.

## 2. Objective

Status becomes a ladder each item climbs once: entered at most once, never
returned to. The status alone says what stage the work is at and who acts next.
Work that is not available to pick up does not show as available.

## 3. Executive summary

- **Nine statuses**, up from eight. "In review" splits into **Design review**
  (proposal out for review) and **In review** (change out for review); new
  **Designing** is the proposal-stage twin of In progress. **Backlog** retires —
  zero items in 209.
- **The common case gets no longer.** Work needing no proposal skips both new
  states and climbs five rungs, as today.
- **Blocked stays a label; partly-delivered stays a decomposition.** Both toggle
  or repeat, so neither can be a rung.
- **Cost:** two options added, one removed, one label created, ~9 in-flight
  items re-filed — all by hand in the GitHub UI. No tooling or automation change.
- **Not solved:** rework after an abandoned PR or a wrong design still moves
  backwards. Declared as a comment-gated exception (§5.2).

---

## 4. The states

| # | State | An issue here is… | Assignee |
|---|---|---|---|
| 1 | **Ideation/Reporting** | filed; nobody has decided we will do it | none |
| 2 | **Planning** | one we will do, whose shape isn't settled — scope, decomposition, whether it needs a design doc | none |
| 3 | **Designing** | one whose design doc is being written | author |
| 4 | **Design review** | one whose design PR is open | none |
| 5 | **Ready** | shape settled — design merged, or none needed — and free to pick up | none |
| 6 | **In progress** | one whose implementation is being written | implementer |
| 7 | **In review** | one whose implementation PR is open | none |
| — | **Done** | shipped and closed | none |
| — | **Rejected** | one we've decided not to do, and closed | none |

3–4 are the design leg, 6–7 the implementation leg. **Ready** is the hinge: the
design question is answered, whichever way.

- **Only Designing and In progress carry an assignee**, and they are the only
  states where someone is at a keyboard on the issue. An assignee is never a
  reservation. Parent issues are exempt (§6.3).
- **Skipping forward is allowed; re-entry is not.** A one-line fix may go
  Ideation/Reporting → In progress in one move.
- **Rejected is reachable from any progress rung**, including late ones.
- **Done is terminal.** A regression in shipped work is a new issue referencing
  the old, never a reopen.

---

## 5. Transitions

| # | Event | From | To |
|---|---|---|---|
| T1 | Triage accepts it | Ideation/Reporting | Planning |
| T2 | Scoping: design doc needed; author takes it | Planning | Designing *(assign)* |
| T3 | Scoping: no design doc needed | Planning | Ready |
| T4 | Design PR opens | Designing | Design review *(unassign)* |
| T5 | Design PR merges | Design review | Ready |
| T6 | Implementer picks it up | Ready | In progress *(assign)* |
| T7 | Implementation PR opens with closing keyword | In progress | In review *(unassign)* |
| T8 | Implementation PR merges; keyword closes the issue | In review | Done *(automatic)* |
| T9 | We decide not to do it | any progress rung | Rejected *(close)* |
| S1 | Filed item picked up immediately | Ideation/Reporting | Ready or In progress |
| S2 | Shape settled and picked up in one sitting | Planning | In progress |

### 5.1 Not transitions

- **A reviewer requests changes.** PR stays open, status stays put, issue stays
  unassigned while the author revises.
- **A PR is retargeted, rebased, split, or stacked.**
- **A gate appears** — waiting on a release, an external party, another issue.
  That is the `blocked` label (§7).

### 5.2 Exception: rework

| # | Event | From | To |
|---|---|---|---|
| X1 | PR closed unmerged, work must be redone | Design review / In review | Designing / In progress *(re-assign)* |
| X2 | Implementation shows the merged design is wrong | In progress or In review | Designing |

Both re-enter a state the issue has occupied. **Both require a comment on the
issue naming what was abandoned and why** — the status can no longer tell the
second pass from the first.

---

## 6. Traces

### 6.1 #1258 — admin hour-correction review screen
Design PR #1497 open, no closing link (correct for a design PR). No
implementation PR. Today: **In review**.

```
Ideation/Reporting → Planning → Designing → Design review ▸
```
Now sits at **Design review**. In review is a state it has not yet entered.

### 6.2 #1396 — merge transfers the background check date
Design merged. Implementation PRs #1450, #1451, #1470 open. Today: **In review**.

```
Ideation/Reporting → Planning → Designing → Design review → Ready → In progress → In review ▸
```
**Finding:** no open PR closes #1396 — `closingIssuesReferences` is empty on
#1450 and #1451, and points to #1260 on #1470. T8 will not fire. Under §7.2 this
is a parent; either give it sub-issues or give one PR the closing keyword.

### 6.3 #975 — legacy two-variant Shopify shape
Design merged. Releases 0+1 shipped (#1464, cleanup #1493). Release 2
(`DROP COLUMN`) outstanding, and cannot start until Release 1 is live in a
published **prod** release — merging to `main` only deploys dev. Today:
**Ready**, which wrongly reads as free to pick up.

Decomposed:
```
#975 (parent)  Ideation/Reporting → Planning → Designing → Design review → In progress ▸
  ├─ Release 0+1 (code)       Ready → In progress → In review → Done
  └─ Release 2 (DROP COLUMN)  Ready + `blocked` ▸
```
Parent skips Ready and holds In progress, **unassigned**, from first child
starting to last child closing. The Release 2 child names its gate in the body:
*"Release 1 live in a published prod release."*

### 6.4 #1224 — individual agreement per adult child
Implementation PR #1477 open, closing link confirmed. Today: **In review**.

```
Ideation/Reporting → Planning → Designing → Design review → Ready → In progress → In review ▸
```
Identical to #1396 — which is the point.

### 6.5 #1230 — "students ≥18 as of Sept 1" report
No design doc. PR #1495 open, closes it. Today: **In review**.

```
Ideation/Reporting → Planning → Ready → In progress → In review ▸
```
Five rungs. T3 skips the design leg at zero cost.

---

## 7. Blocked and partly delivered

### 7.1 Blocked → a `blocked` repo label, gate named in the issue body
Blocking toggles while the work stays where it is, so as a status it forces
Ready → Blocked → Ready — a re-entry. It is orthogonal to progress: an item can
be blocked in Planning, Ready, or In review. Labels toggle freely and filter on
the board (`-label:blocked` gives the pick-up-able view of Ready).

### 7.2 Partly delivered → decomposition, no state
**If a design identifies more than one separately deployable release, file one
issue per release before the first starts, under a parent.** A "Partially
shipped" status repeats at three releases, and does not say what is left or what
gates it. The parent's status is coarse by design; Sub-issues progress covers
the detail.

---

## 8. Mapping from the current options

| Current option | Items | Becomes | Action |
|---|---|---|---|
| Ideation/Reporting | 140 | Ideation/Reporting | keep, definition tightened |
| Planning | 31 | Planning | keep, definition tightened |
| Backlog | **0** | — | **retire** |
| Ready | 1 | Ready | keep, narrowed to "design settled" |
| In progress | 1 | In progress | keep |
| In review | 9 | In review | keep, **narrowed to the implementation leg** |
| Done | 27 | Done | keep |
| Rejected | **0** | Rejected | keep — see open question 2 |
| — | — | **Designing** | **add** |
| — | — | **Design review** | **add** |

### 8.1 Manual steps (GitHub UI — not safely scriptable)

1. Add option `Designing`.
2. Add option `Design review`.
3. Reorder options to the ladder: Ideation/Reporting, Planning, Designing,
   Design review, Ready, In progress, In review, Done, Rejected.
4. Delete option `Backlog` — confirm zero items first; deleting an option with
   items silently clears their status.
5. Create the `blocked` label in `innovationtreehouse/checkin`.
6. Re-file the nine In review items: anything whose only open PR is a design PR
   moves to Design review (#1258 at minimum).
7. Decompose #975 per §6.3; label the Release 2 child `blocked`.

Built-in workflows need no change. "Item closed" and "Pull request merged" fire
only on a *linked* PR; a design PR carries no closing keyword, so it cannot
trigger them. That is why the closing-keyword rule in §9 is load-bearing.

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
| **Planning** | one we will do, whose shape isn't settled — scope, decomposition, whether it needs a design doc | none |
| **Designing** | one whose design doc is being written | author |
| **Design review** | one whose design PR is open | none |
| **Ready** | shape settled — design merged, or none needed — and free to pick up | none |
| **In progress** | one whose implementation is being written | implementer |
| **In review** | one whose implementation PR is open | none |
| **Done** | shipped and closed | none |
| **Rejected** | one we've decided not to do, and closed | none |

**Design leg** = Designing → Design review. **Implementation leg** = In progress
→ In review. **Ready** is the hinge: the design question is answered, whichever
way. Work needing no design skips the design leg entirely.

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
- **Blocked is a label, not a status.** Work waiting on a release, an external
  party, or another issue keeps its status and gains the `blocked` label, with
  the gate named in the issue body. Status tracks progress; blocking toggles,
  and a ladder can't have a rung you step off and back onto.
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

1. **Is Ideation/Reporting one bucket or two?** It holds 140 of 209 items, from
   one-line reports to accepted-but-unscheduled epics. This retires Backlog on
   the evidence it has never been used; the other reading is that it went unused
   *because* it was undocumented, and the real need is Reported → Backlog →
   Planning. One more rung.
2. **Keep Rejected, or just close?** Zero items — unwanted work is being closed
   without it. Closing as "not planned" trips "Item closed" into **Done**, which
   is wrong. Either set Rejected by hand before closing, or drop it and redefine
   Done as "closed, however".
3. **Should Designing require an assignee?** If designs are in practice written
   by whoever is already in the area rather than claimed in advance, Designing
   and Design review collapse into one state — a rung fewer.
4. **Is the "no design needed" call final?** T3 sends an item to Ready. If
   someone in Ready then decides a design *is* needed, that is Ready → Designing,
   covered by neither X1 nor X2. This assumes the call is final and any later
   design becomes X2.
5. **Renaming Ideation/Reporting.** The slash reads badly; a rename touches 140
   items' worth of habit for no functional gain. Left alone here.
6. **Nothing enforces this.** A monotonicity check over each item's
   status-change timeline is buildable but not proposed — §5.2 means it could
   never be a hard gate.

---

## Appendix — evidence

All 209 items on project 1:

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

The five §6 issues, all open, milestone v1.1, all unassigned:

| Issue | Status today | Open PRs | Closing link |
|---|---|---|---|
| #1258 | In review | #1497 (design) | none — correct for a design PR |
| #1396 | In review | #1450, #1451, #1470 | none to #1396; #1470 → #1260 |
| #975 | Ready | none | — (shipped via #1464, #1493) |
| #1224 | In review | #1477 | → #1224 |
| #1230 | In review | #1495 | → #1230 |

#975 release gating: `checkin-app/docs/designs/975-LEGACY_VARIANT_CONTRACT.md`,
section "The deploy hazard (why the DROP is its own release)".
