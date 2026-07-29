# Documentation migration — getting the corpus to the standard

**Status: WORKING DOC — delete when complete.**
One-time plan for moving the existing ~43 docs, and the years of
undocumented decisions into the shape defined by `DOCUMENTATION_STANDARD.md`.
This file is scaffolding: it follows its own rule and gets deleted when the work
lands.

---

## 1. Evidence

### 1.1 Rules ship without a home

Two examples surfaced during a single design review:

- **The intake-note hold.** An applicant note holds the membership application
  at background-check review so reviewers read it before dues are settled —
  unless the household already holds a still-valid background clearance, which
  takes the direct path to payment. Stated only in a code comment in
  `checkin-app/src/lib/membership/external.ts`, a parenthetical inside the
  lifecycle transition table, and one aside in `docs/backlog/CUJS.md`.

- **The member-pricing coverage window.** Member program pricing requires the
  membership to cover the program's end date, not merely be active today; a
  program with no end date requires coverage only through its start. Stated only
  in a JSDoc block in `checkin-app/src/lib/orgMembership.ts` — which tags it
  `POLICY (flag for veto)`, so it is an open question that has been shipping as
  behaviour, not a settled decision. It cannot be written into `docs/rules/`
  until the owner answers it.

Neither was skipped through carelessness. There was no file either one belonged
in. A design doc proposing to change both cited the lifecycle doc (mechanics)
and a pricing doc that is itself an unbuilt proposal, and found nothing factual
to check itself against.

### 1.2 The cost is already measured

An existing PR-history analysis distilled **941 PRs (#249–1372)** and labelled
each with the upstream cause that produced it. **216 of them — just under a
quarter — carry a `SPEC`-stage cause:**

| Cause | PRs | What it means |
|---|---|---|
| `scope-miss` | 116 | a rule existed but was not considered |
| `domain-knowledge-gap` | 82 | a rule nobody had written down |
| `auth-unclear` | 31 | an access or approval rule left undecided |

These columns **overlap** — a PR can carry several causes, so they sum to more
than 216. The 216 is the deduplicated union and is the figure to quote. Adding
`data-model-misfit` (34) brings the rule-bearing set to **243**.

Two counting caveats, so the figure is not overclaimed:

- The corpus counts **all** PRs in range, not merged ones. Merged-only over
  #249–1372 is 885 (816 up to #1168, 69 after). The cause labels are what the
  argument rests on, and those are per-PR regardless of outcome — but "941
  merged PRs" would be wrong.
- The labels come from an LLM distillation pass, owner-reviewed in aggregate but
  not line-by-line. Treat 216 as well-founded, not exact.

A second analysis, run independently to answer a different question, points the
same way: 19% of technical fixes trace to spec gaps, money paths worst
(reconciliation, 43%), and of 229 `feat:` PRs only 24% were real features — the
plurality were business misses.

Roughly one PR in four carries a cause that means a rule was not written down
anywhere a person or an agent would look. That is the quantified case for a
rules register, and why §3 mines this history rather than starting blank.

### 1.3 Sprawl

One doc per change means the corpus grows with the PR count and is never pruned.
Docs describing finished work sit next to live proposals, and a reader cannot
tell which files are worth opening without opening all of them.

---

## 2. Step 1 — seed two rules files

Create `docs/rules/membership.md` and `docs/rules/programs.md` from what is
already known, before any mining. Sources:

- the intake-note hold from §1.1. The member-pricing window is **not** seeded —
  it is tagged `POLICY (flag for veto)` and needs an owner answer first.
- `checkin-app/docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md` — a domain rules doc
  named after one feature; capacity and scholarship policy folds into
  `programs.md`
- `docs/backlog/CUJS.md` journey A1, which already states several membership
  rules inline

`checkin-app/docs/designs/HOUSEHOLD_LEAD_MODEL.md` is **not** a source here.
Its content is guardianship and household leadership, which belongs in
`people-households.md`, not in either seeded file — forcing it into
`membership.md` would violate "named for the domain, not for any feature."
It is handled once, in step 4, and `people-households.md` is created there.

Draft both files with the **Policy / Procedure** split from standard §3.2, even
if the Policy section starts empty — the shape is part of what this step
validates, and an empty Policy heading is an honest signal that nothing has been
traced to a policy yet.

Cut aggressively. Two short files that get read beat six thorough ones that do
not. This step also validates the format before the mining step produces volume.

---

## 3. Step 2 — mine the full PR history for standing rules

**Goal:** recover the decisions that shipped across the repo's history and were
never written anywhere durable. This is the bulk of the value and the only step
that cannot be done incrementally later.

### 3.1 Reuse the existing corpora

Do not re-fetch from scratch. Two corpora already exist, built for different
questions. Both are useful; neither is checked into this repo.

**Primary — the `pr-mining` corpus.** An owner-local working directory holding a
complete, distilled, cause-labelled analysis:

- **941 PRs (#249–1372), 100% distilled** — all PRs in range, merged or not.
  `raw/pr-NNNN.json` is the exported
  PR; `distilled/pr-NNNN.md` is a per-PR summary with YAML frontmatter
  (`claimed_type`, `actual_nature`, `epoch`, `upstream_causes`, `confidence`)
  plus prose sections for *What it actually did*, *Root cause*, *Upstream cause
  analysis*, and *Evidence*.
- `labels.tsv` — one row per PR with cause families and stages already joined.
- `cause-map.tsv` — open-coded phrase → family, so a taxonomy change is a pure
  join and needs no re-LLM pass.
- `scripts/` — the five-phase pipeline (fetch → split → distill → parse →
  label), every stage idempotent and resumable.
- `REPORT.md` — the synthesis; `README.md` — how to reproduce or continue.

This corpus is the right substrate because the distillation already answers the
question this sweep asks. Its `SPEC` stage *is* the "a rule was never written
down" bucket.

**Secondary — the in-repo `analysis/` branch.** Branch
`claude/github-issues-analysis-plan-31f6d4` (commit `0107a949`, unpushed) holds
`pr_facts.jsonl` for 952 PRs and an owner-reviewed 24-category classification
built to answer a different question (what fraction of features were real).
Useful as a cross-check on anything the primary sweep surfaces; not the driver.

**Coverage is current** through #1372; the corpus was topped up and re-labelled.

PRs **#1–248** are deliberately out of scope. They predate the corpus and are
not worth the fetch.

**Reachability — read this before planning around the corpus.** It is
**owner-local by decision** (§8), lives on one machine, and is not in any repo.
No other developer or agent can open it, and the `~/Software/Checkin/pr-mining/`
path in its own `README.md` is stale since the repos moved. The same applies to
the secondary `analysis/` branch, whose commit is unpushed.

That is deliberate: the corpus is a private **input**; the domain rules it
produces are the shared **output**. Nobody should be blocked waiting for access.
But it does mean **only the owner can execute step 2** — if this step needs to
move to someone else, publishing the corpus becomes a prerequisite, not a
detail. `git init` inside it is worth doing regardless, so a long sweep is
resumable and auditable.

### 3.2 Filter to rule-bearing PRs

Most PRs establish no rule. The distilled corpus makes the filter a query rather
than a judgement call — select on stage and family in `labels.tsv`:

| Stage | Family | PRs | Why it bears a rule |
|---|---|---|---|
| SPEC | `scope-miss` | 116 | a rule existed but was not considered |
| SPEC | `domain-knowledge-gap` | 82 | a rule nobody had written down |
| SPEC | `auth-unclear` | 31 | an access or approval rule left undecided |
| PROCESS | `data-model-misfit` | 34 | the model and the policy disagreed |

Families overlap, so do not add the column. The deduplicated set is **243 PRs**
of 941 — that is the sweep. Read each one's *Upstream cause analysis* section;
the rule is usually stated there in plain language already.

```bash
awk -F'\t' 'NR>1 && $5 ~ /scope-miss|domain-knowledge-gap|auth-unclear|data-model-misfit/{print $1}' labels.tsv | sort -un
```

Then check two secondary signals:

- **`half-wired-feature`** (263 PRs, the largest family) — mostly genuine build
  gaps, but a subset are a rule applied on one path and not its siblings. Sample
  rather than read all of them.
- **Churn clusters** — repeated work in one area usually means an unstated rule
  everyone kept guessing at. `REPORT.md` names the ones already found.

Deprioritise entirely: `missing-test-coverage` (238), `pattern-not-followed`
(205), `process-tooling-friction`, `test-infra-reliability`, `none-clean-work`.
These are process and craft findings — real, but they belong in a retrospective,
not in a rules register.

### 3.3 Extract, then discard the source

For each rule-bearing PR, write one candidate rule as a constraint in business
language. Then **drop the PR reference.** The output of this step is rules, not
provenance. Per the standard, no PR number, issue number, or date survives into
`docs/rules/`.

Keep the working extraction list (candidate rule + originating PR) in scratch
during the sweep so duplicates can be spotted — then throw it away. Do not check
it in.

### 3.4 Dedupe and cut

The raw extraction will be far larger than what should ship. Expect to discard
most of it:

- Collapse restatements of the same rule into one line.
- Drop anything that is mechanism, not policy.
- Drop anything a reader would derive from the code.
- Drop rules that are no longer true — verify against current `main`, not
  against the PR that introduced them.

**Judge by the §3.3 test in the standard, not by length:** keep a line only if a
later change could violate it. A sweep over hundreds of PRs will over-produce —
if a domain comes out with dozens of rules, it has almost certainly captured
mechanism rather than policy, so re-apply the test before accepting the volume.
Splitting the file is not the fix.

### 3.5 Classify each rule: policy or procedure

Standard §3.2 splits every domain file into a **Policy** section above a
**Procedure** section. The mine cannot make that call on its own — a PR diff
shows what the code does, never whether a board policy required it.

So the sweep produces everything as **procedure by default**, and a separate
pass promotes what is genuinely policy-backed:

1. Draft every mined rule under Procedure. Never guess at policy authority; an
   unsupported promotion is the same defect as writing an unratified policy as
   settled.
2. Flag candidates — anything touching dues, background checks, eligibility and
   age gates, refunds, volunteer status, or access and certification is likely
   to have a policy behind it. These are the ones worth checking.
3. The owner checks each candidate against the policy corpus (§3.6) and either
   promotes it with a citation by **policy name and article/section** — never a
   page, never a path — or leaves it as procedure.

Expect this to reclassify a meaningful share of the membership and finance
rules, and almost none of the attendance or tooling ones.

**A rule can also be neither.** If a candidate turns out to contradict the
policy it supposedly implements, that is not a documentation finding — it is a
compliance finding, and it goes to the owner directly rather than into any file.

### 3.6 The policy corpus

The governing policies are held by the owner at
`/Volumes/Untitled/Scratchpad/Policies` — outside this repo, outside version
control, readable only on that machine. Same custody model as the PR corpus
(§3.1): a private **input** whose **output** is the citations in `docs/rules/`.

Consequences for this step:

- **Only the owner can run §3.5's promotion pass.** Everyone else drafts under
  Procedure and flags.
- **Reviewers can never verify a citation**, only see the claim and which policy
  it names. Making the register auditable is the goal here; verifiable is out of
  reach until the policies are published.
- **The citation format is what makes this survivable.** Name plus
  article/section stays meaningful to anyone holding the policy, in any format,
  on any machine. A page number or a path would be meaningful only on the
  owner's disk, today.

### 3.7 Owner review

The register states board and operations decisions. A rule inferred from a PR
diff is a *candidate* decision until the owner confirms it. Present each domain
file for review before it merges; some candidates will turn out to be
accidents-of-implementation rather than decisions, and those must not be
enshrined as rules.

---

## 4. Step 3 — update AGENTS.md

- Point the docs map at `docs/rules/` first, as the place to read before
  changing behaviour in a domain.
- Reference `DOCUMENTATION_STANDARD.md` for the working-doc lifecycle and the
  format rules.
- Resolve the CUJS ambiguity: two files share the name `CUJS.md`
  (`docs/designs/CUJS.md`, 98 lines, role-based; `docs/backlog/CUJS.md`,
  276 lines, per-step with status). The docs map currently points at the thinner
  one. Merge or delete one.

---

## 5. Step 4 — empty out the `designs/` directories

Both `docs/designs/` and `checkin-app/docs/designs/` conflate three things with
different lifetimes. Every file goes to one of three places, and **the `designs/`
directories are then deleted** — which also avoids a `designs/` vs `in-design/`
name collision.

**→ `docs/in-design/`** — unbuilt proposals. These are working docs by another
name: `SHOPIFY_MEMBER_SEGMENT_PRICING.md`, `KIOSK_RESILIENCE.md`,
`MEMBERSHIP_SYNC.md`, `PROGRAM_INSTANCE_RESTRUCTURE.md`,
`resilient-load-swr.md`, and the numbered set (`167-`, `354-`, `975-`, `1149_`,
`1224_`, `1256_`, `1333-`). They keep their normal lifecycle from here: extract
and delete when they land, delete outright when abandoned.

**→ `docs/ops/`** — operational reference that stays true and has no rules-file
home: `DEV_INSTANCE_DESIGN.md`, `DEV_DASHBOARD_DESIGN.md`,
`BG_CHECK_DEV_MOCK.md`, `ZOHO_SIGN_DEV_MOCK.md`, `SHOPIFY_DEV_STORE_WEBHOOK.md`,
`SHOPIFY_LIVE_TESTS.md`, `S_READ_DIAGNOSTICS.md`. `LIFECYCLE.md` goes here too —
it documents how the generated artifacts and drift guards work, which is
mechanism, not policy.

**→ extract, then delete** — shipped feature docs: `HOUSEHOLD_LEAD_MODEL.md`
(promotes into `people-households.md`, created here), `INDEX_PAGE_SCOPING.md`,
`MY_PROGRAMS_SCOPING.md`, `ARCHITECT_IDEAS_o46.md`, `DESIGN.md`. Check each for
standing rules first; most will yield none.

**`PRODUCTION_PLAN.md` moves to `docs/ops/` — do not delete it.** Despite the
name it is the live "Production Launch Runbook" for ops.innovationtreehouse.org:
an ordered cutover checklist with open items (trust-policy verification,
release-gate roster, ECR/ECS task-definition names). Extraction yields no rules,
so the extract-and-delete bucket would destroy the only deploy/rollback runbook.
The ops-bucket definition already covers it.

**Unresolved, decide during the sweep:** `CUJS.md` (both copies — see step 3),
`UNFINISHED.md` (a deferred-decision ledger; arguably belongs in `in-design/`,
arguably its own thing).

**Leave alone entirely:** `docs/security/`, `checkin-app/docs/generated/`,
`docs/backlog/`, `checkin-app/docs/VOCABULARY.md`, and the deploy/migration docs
under `checkin-app/docs/`.

### 5.1 Reference sweep — do this BEFORE any move or delete

Deleting or moving a doc that other files cite leaves dead pointers. There are
currently **63 references to `docs/designs/…`** across `checkin-app/src`,
`.github/`, `README.md`, and `AGENTS.md` — README front-page links and the
AGENTS.md instruction to read `DEV_INSTANCE_DESIGN.md` before touching auth/env
among them.

```bash
grep -rn "docs/designs/" checkin-app/src .github README.md AGENTS.md docs
```

Every hit is updated to the new path, or removed if its target is being deleted.
The sweep is part of the same change as the move — never a follow-up.

**One reference is not a plain text edit.**
`checkin-app/src/lib/lifecycle/artifacts.ts:115` bakes the literal string
`Generated from the machine's TRANSITIONS (docs/designs/LIFECYCLE.md)` into the
generated artifacts, and `artifactsDrift.test.ts` asserts byte-equality against
them. So moving `LIFECYCLE.md` requires, in one commit:

1. update the literal in `artifacts.ts`,
2. re-run `npm run generate:lifecycle-artifacts`,
3. commit the regenerated files with it.

Edit the string without regenerating and CI goes red on a confusing docs-path
diff; skip the edit and the drift-tested, "do not hand-edit" artifacts ship a
path that no longer exists — the one document class the standard calls
machine-verified would be provably wrong.

---

## 6. Step 5 — fix the root-vs-app split

`docs/` at the repo root and `checkin-app/docs/` both hold app design docs, and
the line is violated in both directions (`MEMBERSHIP_SYNC.md` is app design at
the root; `LIFECYCLE.md` is app mechanics under `checkin-app/`).

Proposed rule: repo root holds product, policy, and cross-cutting process;
`checkin-app/docs/` holds app-implementation reference. Mechanical once agreed —
do it last, after the rules register exists, so nothing moves twice.

---

## 7. Done when

- `docs/rules/` holds the domain files, each owner-reviewed, every line a rule a
  change could violate.
- **Every domain file carries the Policy / Procedure split**, policy above
  procedure, and every policy-tier rule cites a policy by name and
  article/section — no page numbers, no filesystem paths.
- **Any contradiction found between code and policy has been raised with the
  owner**, not silently recorded as a rule.
- AGENTS.md points at the register and at `DOCUMENTATION_STANDARD.md`.
- No `Status: SHIPPED` feature docs remain outside `docs/ops/`.
- `docs/designs/` and `checkin-app/docs/designs/` no longer exist.
- **`grep -rn "docs/designs/" checkin-app/src .github README.md AGENTS.md docs`
  returns nothing.**
- **`npm run generate:lifecycle-artifacts` produces no diff**, and
  `artifactsDrift.test.ts` passes.
- **`PRODUCTION_PLAN.md` is in `docs/ops/`**, not deleted.
- Only one `CUJS.md`.
- This file is deleted.

---

## 8. Open questions

1. **Domain list.** Are the six in the standard the right cut, or do membership
   and finance-payments collapse into one?
2. **Who owns a rules file?** CODEOWNERS on `docs/rules/` would route rule
   changes to the board or owner automatically. Worth it, or too heavy?

**Decided:**

- **Working docs live with the change, in its PR** — not in `docs/backlog/`,
  which is an inventory rather than a staging area. Recorded in the standard.
- **No epoch cutoff on the mine.** The epoch boundary (2026-07-03) marks the
  start of production, not a break in what is true. Rules established before it
  remain valid; only the *character* of PRs changed, from major-refactoring work
  to fixes found against a live app. Mine the whole corpus.
- **No #1–248 backfill.** Out of scope; the corpus starts at #249.
- **Corpus stays local.** `pr-mining` is an owner-local input; only the rules it
  produces are shared. Revisit only if a second sweep needs to reproduce this one.
