# Documentation standard

**Status: PROPOSED — for review. Becomes the standard on merge.**
How documentation in this repo is organised, written, and retired. Read this
before writing or moving any doc.

---

## 1. Why this exists

Documentation organised by *what change produced it* tells you whether a change
landed. It does not tell you **what is true now** — so a rule only gets written
down if it happened to be large enough to warrant its own doc, and a doc
describing a shipped change silently decays into a wrong statement of current
behaviour.

This standard adds one register that is maintained rather than frozen — the
domain rules — and gives everything else a shorter life.

---

## 2. Document classes

| Where | What | Lifetime |
|---|---|---|
| `docs/rules/` | Board and operations decisions; invariants new work must not violate | **Permanent, edited by later changes** |
| `docs/ops/` | How to run, deploy, test, and mock things | Long-lived, edited as tooling changes |
| `docs/security/` | Security policy and boundary rules | Long-lived |
| `checkin-app/docs/generated/` | Machine-derived artifacts, drift-tested | Regenerated, never hand-edited |
| `docs/backlog/` | Journey inventory and gap tracking | Long-lived |
| `docs/in-design/` | Proposals and designs being worked right now | **Deleted at merge** |

Most of these are edited over time — ops docs follow the tooling, security
policy evolves, the backlog is maintained continuously. What sets `docs/rules/`
apart is *what triggers* the edit.

A doc in any other class changes when **the thing it describes** changes: new
mock, new deploy step, new gap found. That is ordinary upkeep, and it falls on
whoever touches that thing.

`docs/rules/` changes when **any work in its domain** establishes, alters, or
retires a rule — even work that has nothing to do with documentation. That makes
it the one class carrying an obligation outward onto unrelated changes, which is
why the extract step in §4 exists at all.

---

## 3. `docs/rules/` — the domain register

One file per domain, named for the domain and not for any feature:

| File | Covers |
|---|---|
| `membership.md` | org membership: application, review, dues, renewal, lapse |
| `programs.md` | programs and enrollment: eligibility, capacity, pricing, scholarships |
| `people-households.md` | households, leads, guardianship, youth/adult status |
| `finance-payments.md` | payment, refunds, exceptions, reconciliation obligations |
| `attendance-checkin.md` | check-in, kiosk, visits, hours |
| `tools-certification.md` | tool levels, certification, shop access |

Add a file when a domain genuinely accumulates standing rules. Do not create
empty ones in advance.

### 3.1 What belongs

Decisions the board or operations have made about how things work, and
invariants that later work must not violate.

**Not:** implementation mechanism, state-machine structure (already generated and
drift-tested under `checkin-app/docs/generated/`), rollout sequencing, or
anything a reader could derive by reading the code.

### 3.2 Two tiers — policy first, then procedure

Not every rule has the same authority, and a reviewer needs to know which kind
they are looking at. Each domain file is split in two, **policy first**:

**Policy** — the rule exists because the board or the organisation adopted a
policy. The code implements it; it does not define it. **Cite the governing
policy.** A change that violates one of these is not a design disagreement to be
settled in review: the policy has to change first, which is a board action. A
reviewer's correct response is to stop and escalate, not to weigh trade-offs.

**Procedure** — everything else. Working agreements about how this system
behaves: conventions, operational choices, invariants the team settled on
because something had to be decided. Real rules that later work must not
casually violate, but they can be renegotiated by the people doing the work,
in a PR, without going to the board.

Order matters. Policy goes above procedure in every file so the
highest-authority constraints are read first and cannot be lost in a list.

**Citing a policy.** Name the policy and its **structural location** — article,
section, subsection, clause, whichever that policy actually uses. `Background
Check Policy §2`, `Bylaws Art. IV §3(b)`, `Financial Controls Policy §5.2`.

**Never cite a page number.** A page is an artifact of rendering: it moves when
the document is reformatted, differs between PDF and print, and does not exist
at all in some formats. The structural reference is part of the policy's own
text and survives everything except an actual amendment — at which point the
citation *should* break, because the rule may have changed.

**Never cite a filesystem path.** The policy corpus lives outside this repo (see
§3.5), so a path dangles for everyone but its owner and rots the way line numbers
do. The policy's name plus its section is what survives a reorganisation.

If a policy has no internal numbering to cite, say so explicitly ("*Volunteer
Policy* — unnumbered") rather than inventing a locator or falling back to a
page. That gap is worth surfacing: it usually means the policy needs structure.

**Do not promote a rule to the policy tier to give it weight.** If you cannot
name the policy it comes from, it is procedure. A rule that merely *feels*
official is the same defect as an unratified policy written as settled.

### 3.3 Format

Grouped under short headings, one rule per bullet, written in business language
so a reviewer can judge a diff against it without opening code:

```markdown
## Policy

- Membership activates only after background-check clearance. Payment arriving
  first does not activate; clearance arriving first does not activate.
  — *Background Check Policy §2*

## Procedure

- An intake note holds the application at background-check review, so reviewers
  read it before dues are settled — a family writing "treat us as a volunteer
  household" must not pay first. A household that already holds a still-valid
  background clearance is exempt and goes straight to payment.
```

Note what the second rule spends a whole clause on: the **exemption**. An earlier
draft of this document stated it without the clearance carve-out, which would
have marked shipped, correct code as a violation. State the guards and carve-outs
the code actually has, or the register does damage rather than none.

(The tier split above is illustrative. Which of these is actually
policy-backed is settled during the migration, against the real policy corpus.)

**Write rules as constraints, not descriptions.** If the sentence does not let a
reviewer tell whether a change violates it, rewrite the sentence.
"Payment does not open until reviewers have read the note" is checkable.
"The intake system supports notes" is not.

**No PR numbers, issue numbers, or dates.** These files say what is true, not
how it came to be. Change history lives in git and in the PR record, where it is
linked to a diff and stays accurate on its own.

**No line-number citations.** They rot within weeks and pull the register toward
implementation when what a reviewer needs is the rule. A bare file path is the
most a "where this bites" pointer should carry, and most rules need none.

**Never state an over-broad rule.** A rule that claims more than the code does is
worse than no rule: it marks correct behaviour as a violation, and the likely
response is someone "fixing" working code to comply. When in doubt, state the
narrower version, or leave it out and raise it.

**An unratified policy is a candidate, not a rule.** Code sometimes carries a
decision that was never actually decided — a `POLICY (flag for veto)` comment, a
choice made to unblock a PR and never confirmed. Writing it here converts an open
question into a stated invariant nobody agreed to. Take it to the owner or the
board first; record it only once it is answered.

### 3.4 How much belongs

Enough but not too much. A domain has however many rules it has — some will be
genuinely denser than others, and an arbitrary page count would either be
ignored or cut real rules to meet it.

Test each line, not the file:

- **Could a change violate it?** If you cannot picture the PR that gets this
  wrong, it is background, not a rule. Cut it.
- **Would a reader derive it from the code anyway?** Then it is mechanism. Cut it.
- **Does it duplicate a line already here?** Merge them.

Test the file by whether it still gets read. If reviewers start skimming it, the
register has stopped working — and the cause is nearly always mechanism that
crept in, not a domain that genuinely has too many rules. Look for that first.
Splitting the file hides the symptom without fixing it.

### 3.5 Where the policies live

The governing policies are **not in this repo**. They are held by the owner at
`/Volumes/Untitled/Scratchpad/Policies` — outside version control and readable
only on that machine.

This has a consequence worth stating plainly: **a reviewer cannot verify a policy
citation.** They can see that a rule claims policy authority and which policy it
names, but not that the cited article says what the rule says. The register makes
the claim auditable, not verified.

That is the reason for the naming discipline in §3.2. A citation by policy name
and article is meaningful to anyone holding the policy, in any format, at any
time. A citation by path or page is meaningful only to the one machine that has
the file open right now.

Two consequences for practice:

- **Only someone with the policy corpus can classify a rule as policy-tier.**
  Everyone else writes it as procedure and flags it for reclassification.
- **If the policies are ever published**, this section is where the pointer goes.
  Publishing them would turn every policy-tier rule from auditable into
  verifiable, which is the single biggest available improvement to this register.

---

## 4. Working docs — `docs/in-design/`

A doc written while designing or building something is welcome and useful. Edit
it freely and skip the status ceremony — the folder it sits in already says it
is unfinished.

**Where it lives:** `docs/in-design/<name>.md`. One folder, so anyone can see
what is currently being worked at a glance, and so nothing unfinished is mistaken
for settled.

Not `docs/backlog/` — that is an inventory of what exists and what does not,
maintained over time; mixing disposable per-change docs into it defeats both
purposes. Not the `docs/` root — that is for settled, permanent material.

Anything sitting in `docs/in-design/` is by definition not yet true. Do not cite
it as ground truth in another design, and do not implement against it without
checking whether it landed.

At merge:

```
extract   whatever standing rules the work established, into docs/rules/<domain>.md
delete    the working doc
```

How many is however many there are — often none, sometimes one, occasionally
several. Ask of each candidate the §3.4 question: *could a later change violate
this?* If yes it is a rule and it goes in, however many that turns out to be. If
no, leave it out, even if that empties the list.

The failure to avoid is treating this as a quota — hunting for rules to justify
the step, or stopping once a couple are written while a real one goes unrecorded.

**Extracting nothing is a normal outcome.** Most changes do not establish new
rules. Delete the working doc and add nothing.

If a working doc turns out to be operational reference rather than feature
design — how to run a mock, how an environment behaves — move it to `docs/ops/`
instead of deleting it. It stays true and has no home in the rules register.

A doc describing finished work that has nothing durable to say is sprawl. Delete
it.

---

## 5. Enforcement

**PR review, not tests.** A reviewer reads the domain rules for the area a
change touches and catches a violation before it merges.

To give reviewers something concrete to check, a working doc or design should
name the domain rules it relies on or intends to change. A change that alters a
rule says so explicitly rather than leaving the reviewer to notice.

**Known limitation.** Nothing catches an *omitted* rule. A change that
establishes a new invariant without writing it down leaves no trace a test or
lint could find. The mitigation is that `docs/rules/` stays worth reading during
review — see §3.4. This standard does not claim to close that gap mechanically,
and no test should be built to pretend otherwise.

---

## 6. Guidance for agents

1. **Before changing behaviour in a domain, read `docs/rules/<domain>.md`.** If
   your change contradicts a rule there, that is a decision for the board or the
   owner — raise it, do not quietly proceed. A **Policy**-tier rule is not
   negotiable in a PR at all: stop and escalate.
2. **Never promote a rule to the Policy tier without naming the policy**, and
   never cite one by page number or filesystem path — name plus article,
   section, or subsection only.
3. **A working doc is fine while building — put it in `docs/in-design/`.** No
   `Status:` header ceremony; the folder carries that meaning.
4. **Never cite a doc in `docs/in-design/` as ground truth.** It describes
   something that is not yet true. Check whether it landed before building on it.
5. **At merge, extract and delete.** Move the standing rules into the domain
   doc; delete the working doc. Extracting nothing is normal.
6. **Never put PR numbers, issue numbers, or dates in `docs/rules/`.**
7. **Never put line-number citations in `docs/rules/`.**
8. **Write rules as constraints.** A reviewer must be able to recognise a
   violation from the sentence alone.
9. **Do not add mechanism to a rules file.** Structure belongs in the generated
   artifacts; how the code achieves something belongs in the code.
10. **Do not create empty domain files** in anticipation of future rules.
11. **Prefer cutting to adding.** Every line should be a rule a change could
    violate; anything else dilutes the ones that matter.
