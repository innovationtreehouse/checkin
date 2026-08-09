#!/usr/bin/env bash
# Assign a discussion's agreed issues to its milestone.
#
# The model returns one thing: an array of integers. Everything else — which
# milestone, what the comment says — is derived here from the discussion or
# from a fixed template. That is deliberate. The discussion is attacker-
# controllable text on a public repo, and the narrower the model's output, the
# less an injected instruction has anywhere to go: it cannot name a milestone,
# cannot author text that gets posted, and cannot express an action other than
# "assign these numbers", because there is no field for one.
#
# No model runs past this line. Every decision below is a comparison against an
# API value, so a model here would add nondeterminism to a write path and decide
# nothing. `pr-target-label.yml` is the same shape and is plain bash.
#
# Order is the failure story: read everything, refuse as a unit, then write. A
# crash mid-write leaves a milestone holding some of its issues — visibly
# incomplete, never wrong — and a re-run converges, because every write is
# "set if unset" and the repo state is the checkpoint.
set -euo pipefail

PLAN="${1:?usage: apply.sh <plan.json> <thread.json>}"
THREAD="${2:?}"
: "${REPO:?REPO must be set (owner/name)}"
: "${NUM:?NUM must be set (the discussion number)}"
: "${ACTOR:?ACTOR must be set (who asked for this)}"
MAX_ISSUES=25

fail() { echo "::error::$*"; exit 1; }

# ── the model's entire contribution: a list of integers ────────────────────
jq -e 'type == "array" and (length == 0 or all(type == "number"))' "$PLAN" >/dev/null 2>&1 \
  || fail "planner did not return a JSON array of issue numbers"
mapfile -t WANT < <(jq -r '.[]' "$PLAN")
[ "${#WANT[@]}" -gt 0 ]            || fail "planner returned no issues — nothing to apply"
[ "${#WANT[@]}" -le "$MAX_ISSUES" ] || fail "${#WANT[@]} issues exceeds the cap of $MAX_ISSUES"
[ "$(printf '%s\n' "${WANT[@]}" | sort -u | wc -l)" -eq "${#WANT[@]}" ] || fail "duplicate issue number"

# A locked discussion cannot be commented on, so the result — and the reversal
# manifest inside it — would have nowhere to land. Refuse before writing rather
# than assign the issues and lose the record of it.
[ "$(jq -r '.locked' "$THREAD")" = "false" ] \
  || fail "discussion #$NUM is locked — the result comment cannot be posted, so nothing is applied"

# ── the milestone comes from the discussion title, not the model ───────────
TITLE=$(jq -r '.title' "$THREAD")
MILESTONE=$(grep -oE 'v[0-9]+\.[0-9]+' <<<"$TITLE" | head -1) \
  || fail "discussion title names no vMAJOR.MINOR milestone: $TITLE"
[ -n "$MILESTONE" ] || fail "discussion title names no vMAJOR.MINOR milestone: $TITLE"

# ── refuse as a unit, before the first write ───────────────────────────────
# Every number must appear in the discussion BODY. A number that reached the
# plan from a comment is either a hallucination or an injection; both look the
# same from here and both are refused.
BODY=$(jq -r '.body' "$THREAD")
declare -A CURRENT
for n in "${WANT[@]}"; do
  # JSON "number" still admits -5, 1484.5 and 1E+400, and $n goes straight into
  # a grep -E pattern and a URL path. `1484.5` matches #148415 in the body,
  # because `.` is a metacharacter. Digits only.
  [[ "$n" =~ ^[0-9]+$ ]] || fail "plan issue number '$n' is not a number"
  grep -qE "(^|[^0-9])#$n([^0-9]|$)" <<<"$BODY" || fail "#$n is not in the discussion body"
  meta=$(gh api "repos/$REPO/issues/$n" --jq '[.state, (.pull_request != null), (.milestone.title // "")] | @tsv' 2>/dev/null) \
    || fail "#$n does not exist in $REPO"
  IFS=$'\t' read -r state is_pr ms <<<"$meta"
  [ "$state" = "open" ]  || fail "#$n is $state — the discussion is stale; edit it rather than applying it"
  [ "$is_pr" = "false" ] || fail "#$n is a pull request"
  # An issue already on another milestone is somebody else's plan. Moving it
  # silently is the one mistake that leaves no trace, so refuse.
  [ -z "$ms" ] || [ "$ms" = "$MILESTONE" ] || fail "#$n is already on milestone '$ms'"
  CURRENT[$n]="$ms"
done

# ── resolve or create the milestone ────────────────────────────────────────
# `gh api --jq` takes one expression and has no --arg, so pipe to jq instead.
# --paginate emits one array per page; -s/add folds them into one list.
NUMBER=$(gh api "repos/$REPO/milestones?state=all&per_page=100" --paginate \
  | jq -r --slurp --arg t "$MILESTONE" 'add // [] | map(select(.title == $t)) | .[0].number // empty')
CREATED=false
if [ -n "$NUMBER" ]; then
  # Adopt, never PATCH: a description on an existing milestone is a human's edit.
  echo "Adopting milestone $MILESTONE (#$NUMBER)"
else
  NUMBER=$(gh api -X POST "repos/$REPO/milestones" -f title="$MILESTONE" \
    -f description="Assembled from discussion #$NUM." --jq .number)
  CREATED=true
  echo "Created milestone $MILESTONE (#$NUMBER)"
fi

# ── write ──────────────────────────────────────────────────────────────────
CHANGES='[]'; SKIPPED='[]'; FAILED=0
for n in "${WANT[@]}"; do
  if [ "${CURRENT[$n]}" = "$MILESTONE" ]; then
    echo "#$n -> $MILESTONE [SKIP already]"
    SKIPPED=$(jq -c --argjson i "$n" '. + [$i]' <<<"$SKIPPED"); continue
  fi
  if gh api -X PATCH "repos/$REPO/issues/$n" -F milestone="$NUMBER" >/dev/null; then
    echo "#$n (none) -> $MILESTONE [OK]"
    CHANGES=$(jq -c --argjson i "$n" '. + [$i]' <<<"$CHANGES")
  else
    echo "::warning::#$n assignment failed"; FAILED=$((FAILED + 1))
  fi
  sleep 1   # secondary rate limits return 403s that read like permission errors
done

# ── report, from a fixed template ──────────────────────────────────────────
# Every word below is written here. No model output is echoed, so there is no
# path for an injected instruction to reach a public comment.
MANIFEST=$(jq -nc --arg m "$MILESTONE" --argjson num "$NUMBER" --argjson c "$CREATED" \
  --argjson ch "$CHANGES" --argjson sk "$SKIPPED" \
  '{milestone:$m, number:$num, created:$c, changed:$ch, skipped:$sk}')
list() { jq -r 'if length == 0 then "none" else map("#\(.)") | join(", ") end' <<<"$1"; }

{
  echo "<!-- discussion-milestone:v1 -->"
  echo "Applied this discussion to milestone **$MILESTONE**, as asked by @$ACTOR."
  echo
  echo "- assigned: $(list "$CHANGES")"
  echo "- already on $MILESTONE: $(list "$SKIPPED")"
  echo "- milestone: $([ "$CREATED" = true ] && echo created || echo "adopted (existing)")"
  echo
  echo "Anything the discussion lists that is missing above was left off on purpose:"
  echo "a closed issue, a pull request, an issue already on another milestone, or a"
  echo "candidate the thread had not settled. Edit the discussion and ask again."
  echo
  echo "<details><summary>Reversal manifest</summary>"
  echo; echo '```json'; echo "$MANIFEST"; echo '```'
  echo; echo "</details>"
} > comment.md

DISCUSSION_ID=$(jq -r '.id // empty' "$THREAD")
gh api graphql -F body=@comment.md -F id="$DISCUSSION_ID" \
  -f query='mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{url}}}' \
  --jq '.data.addDiscussionComment.comment.url'

[ "$FAILED" -eq 0 ] || fail "$FAILED assignment(s) failed — re-run to converge"
