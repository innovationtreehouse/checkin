# Documentation migration — getting the corpus to the standard

**Status: WORKING DOC — delete when complete.**
One-time plan for moving the existing ~43 docs and ~1,028 merged PRs' worth of
undocumented decisions into the shape defined by `DOCUMENTATION_STANDARD.md`.
This file is scaffolding: it follows its own rule and gets deleted when the work
lands.

---

## 1. Evidence

### 1.1 Rules ship without a home

Two examples surfaced during a single design review:

- **The intake-note hold.** An applicant note holds the membership application
  at background-check review; payment does not open until reviewers have read
  it, so a family writing "treat us as a volunteer household" has dues settled
  before they pay. Stated only in a code comment in
  `checkin-app/src/lib/membership/external.ts`, a parenthetical inside the
  lifecycle transition table, and one aside in `docs/backlog/CUJS.md`.

- **The member-pricing coverage window.** Member program pricing requires the
  membership to be valid through the program's whole run, not merely active
  today. Stated only in a JSDoc block in
  `checkin-app/src/lib/orgMembership.ts` — where it is explicitly tagged as a
  policy call awaiting a veto, and has sat there since.

Neither was skipped through carelessness. There was no file either one belonged
in. A design doc proposing to change both cited the lifecycle doc (mechanics)
and a pricing doc that is itself an unbuilt proposal, and found nothing factual
to check itself against.

### 1.2 The cost is already measured

An existing PR-history analysis distilled 861 merged PRs (#249–1168) and
labelled each with the upstream cause that produced it. **192 of them — a
little over a fifth — trace to the `SPEC` stage**, which decomposes as:

| Cause | PRs | What it means |
|---|---|---|
| `scope-miss` | 87 | a rule existed but was not considered |
| `domain-knowledge-gap` | 63 | a rule nobody had written down |
| `auth-unclear` | 26 | an access or approval rule left undecided |

A second analysis, run independently to answer a different question, agrees:
19% of technical fixes trace to spec gaps, money paths worst (reconciliation,
43%), and of 229 `feat:` PRs only 24% were real features — the plurality were
business misses.

Roughly one PR in five exists because a rule was not written down anywhere a
person or an agent would look. That is the quantified case for a rules register,
and it is why §3 mines this history rather than starting from a blank page.

### 1.3 Sprawl

One doc per change means the corpus grows with the PR count and is never pruned.
Docs describing finished work sit next to live proposals, and a reader cannot
tell which files are worth opening without opening all of them.

---

## 2. Step 1 — seed two rules files

Create `docs/rules/membership.md` and `docs/rules/programs.md` from what is
already known, before any mining. Sources:

- the two rules in §1.1
- `checkin-app/docs/designs/HOUSEHOLD_LEAD_MODEL.md` — a rules doc wearing a
  design-doc hat; its content promotes directly
- `checkin-app/docs/PROGRAM_CAPACITY_AND_SCHOLARSHIPS.md` — a domain rules doc
  named after one feature; capacity and scholarship policy folds into
  `programs.md`
- `docs/backlog/CUJS.md` journey A1, which already states several membership
  rules inline

Cut aggressively. Two short files that get read beat six thorough ones that do
not. This step also validates the format before the mining step produces volume.

---

## 3. Step 2 — mine the full PR history for standing rules

**Goal:** recover the decisions that shipped over ~1,028 merged PRs and were
never written anywhere durable. This is the bulk of the value and the only step
that cannot be done incrementally later.

### 3.1 Reuse the existing corpora

Do not re-fetch from scratch. Two corpora already exist, built for different
questions. Both are useful; neither is checked into this repo.

**Primary — the `pr-mining` corpus.** An owner-local working directory holding a
complete, distilled, cause-labelled analysis:

- **861 PRs (#249–1168), 100% distilled.** `raw/pr-NNNN.json` is the exported
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

**Coverage gap to close before the sweep:** PRs **#1169 and later** (80 merged
since the last export). Fetchable with the existing pipeline, which skips work
already on disk.

PRs **#1–248** are deliberately out of scope. They predate the corpus and are
not worth the fetch.

**Three practical notes.** The corpus is owner-local and lives on one machine —
it is a private *input*, and the domain rules it produces are the shared
*output*; nothing about the sweep should assume another developer can see it.
It is not a git repository, and `git init` is worth doing first so a
long-running sweep is resumable and auditable. Its `README.md` still says to run
from `~/Software/Checkin/pr-mining/`, which is stale since the repos moved —
fix the path while you are in there.

### 3.2 Filter to rule-bearing PRs

Most PRs establish no rule. The distilled corpus makes the filter a query rather
than a judgement call — select on stage and family in `labels.tsv`:

| Stage | Family | PRs | Why it bears a rule |
|---|---|---|---|
| SPEC | `scope-miss` | 87 | a rule existed but was not considered |
| SPEC | `domain-knowledge-gap` | 63 | a rule nobody had written down |
| SPEC | `auth-unclear` | 26 | an access or approval rule left undecided |
| PROCESS | `data-model-misfit` | 30 | the model and the policy disagreed |

That is the sweep: roughly **200 PRs**, not 1,028. Read each one's *Upstream
cause analysis* section — the rule is usually stated there in plain language
already.

Then check two secondary signals:

- **`half-wired-feature`** (242 PRs, the largest family) — mostly genuine build
  gaps, but a subset are a rule applied on one path and not its siblings. Sample
  rather than read all of them.
- **Churn clusters** — repeated work in one area usually means an unstated rule
  everyone kept guessing at. `REPORT.md` names the ones already found.

Deprioritise entirely: `missing-test-coverage` (219), `pattern-not-followed`
(191), `process-tooling-friction`, `test-infra-reliability`, `none-clean-work`.
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

### 3.5 Owner review

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
(promotes into `people-households.md`), `INDEX_PAGE_SCOPING.md`,
`MY_PROGRAMS_SCOPING.md`, `PRODUCTION_PLAN.md`, `ARCHITECT_IDEAS_o46.md`,
`DESIGN.md`, `INDEX_PAGE_SCOPING.md`, `MY_PROGRAMS_SCOPING.md`. Check each for
standing rules first; most will yield none.

**Unresolved, decide during the sweep:** `CUJS.md` (both copies — see step 3),
`UNFINISHED.md` (a deferred-decision ledger; arguably belongs in `in-design/`,
arguably its own thing).

**Leave alone entirely:** `docs/security/`, `docs/generated/`, `docs/backlog/`,
`checkin-app/docs/VOCABULARY.md`, and the deploy/migration docs under
`checkin-app/docs/`.

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
- AGENTS.md points at the register and at `DOCUMENTATION_STANDARD.md`.
- No `Status: SHIPPED` feature docs remain outside `docs/ops/`.
- `docs/designs/` and `checkin-app/docs/designs/` no longer exist.
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
