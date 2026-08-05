# Issue workflow — the rules

Destination: replaces `AGENTS.md` § "Issue workflow (org project 1)" in full.
Everything below the rule is that section's text, ready to paste.
Getting there is `ISSUE_WORKFLOW_MIGRATION.md`.

---

## Issue workflow (org project 1)

Org **project 1** is the canonical triage surface. Its Status field is a
**forward-only ladder**: an issue enters each state at most once and never
returns to one it has left. Jumping *forward* past states is fine — a one-line
fix can go Ideation/Reporting → In progress in one move; re-entering a state is
not. Status says what stage the work is at; the assignee says whether someone is
at a keyboard on it right now.

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
way — work needing no design skips the design leg entirely. **Rejected** is
reachable from any rung. **Done is terminal**: a regression in shipped work is a
new issue referencing the old one, never a reopen.

| Event | From | To |
|---|---|---|
| Triage accepts it | Ideation/Reporting | Planning |
| Scoping: design doc needed, author takes it | Planning | Designing *(assign)* |
| Scoping: no design doc needed | Planning | Ready |
| Design PR opens | Designing | Design review *(unassign)* |
| Design PR merges | Design review | Ready |
| Implementer picks it up | Ready | In progress *(assign)* |
| Implementation PR opens | In progress | In review *(unassign)* |
| Implementation PR merges | In review | Done *(automatic)* |
| We decide not to do it | any rung | Rejected *(close)* |

**Assignment means one thing: someone is working it right now.** Only Designing
and In progress carry an assignee — never leave one standing as a soft
reservation, and never trust it as the only claim signal. A parent issue is
exempt: it sits in **In progress**, unassigned, from its first child starting
until its last child closes.

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
    registered via `closingIssuesReferences`. Without it the merge closes
    nothing and Status never reaches Done.
- **Not a state change**: a reviewer requesting changes — the PR stays open, the
  status stays put, and the issue stays unassigned while the author revises — or
  a PR being retargeted, rebased, split, or stacked.
- **Merge**: a merged design PR → set Status **Ready** for implementation
  pickup. A merged implementation PR needs nothing manual — the closing keyword
  closes the issue and the project's built-in workflows set Status → Done.
- **Blocked is a label, not a status.** Work waiting on a release, an external
  party, or another issue keeps its status and gains the `blocked` label, with
  the gate named in the issue body. Status tracks progress; blocking toggles,
  and a ladder can't have a rung you step off and back onto.
- **More than one deployable release = more than one issue.** If a design names
  separately deployable releases with an ordering constraint between them, file
  one issue per release before the first one starts, under a parent. Merging to
  `main` only deploys dev — prod cuts from a published release, so two PRs
  merged before one release land in prod together.
- **Rework is the one backward move**, and it is comment-gated. If a PR is
  closed unmerged and the work must be redone, or implementation shows a merged
  design is wrong, move back to Designing / In progress **and comment on the
  issue saying what was abandoned and why**. The status can no longer tell the
  second pass from the first; that comment is what does.

Project-field writes need the `project` token scope; if GraphQL returns
INSUFFICIENT_SCOPES, have the user run `gh auth refresh -s project`.
