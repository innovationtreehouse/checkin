#!/usr/bin/env bash
# Validate the planner's proposal against facts fetched here, then apply it.
#
# No model runs past this line. Every decision below is a comparison against an
# API value — does this milestone exist, is this issue open, is it already
# somewhere else — so a model would add nondeterminism to a write path and
# decide nothing. `pr-target-label.yml` is the same shape and is plain bash.
#
# Order matters and is the whole failure story: read everything, refuse as a
# unit, then write. A crash mid-write leaves a milestone holding some of its
# issues — visibly incomplete, never wrong — and a re-run converges, because
# every write is "set if unset" and the repo state is the checkpoint.
set -euo pipefail

PLAN="${1:?usage: apply.sh <plan.json> <thread.json>}"
THREAD="${2:?}"
MAX_ISSUES=25

fail() { echo "::error::$*"; exit 1; }

jq -e . "$PLAN" >/dev/null 2>&1 || fail "planner did not emit valid JSON"

MILESTONE=$(jq -r '.milestone // empty' "$PLAN")
[ -n "$MILESTONE" ] || fail "planner named no milestone: $(jq -r '.notes // ""' "$PLAN")"
[[ "$MILESTONE" =~ ^v[0-9]+\.[0-9]+$ ]] || fail "milestone '$MILESTONE' is not vMAJOR.MINOR"

mapfile -t WANT < <(jq -r '.issues[].number' "$PLAN")
[ "${#WANT[@]}" -gt 0 ] || fail "planner proposed no issues: $(jq -r '.notes // ""' "$PLAN")"
[ "${#WANT[@]}" -le "$MAX_ISSUES" ] || fail "${#WANT[@]} issues exceeds the cap of $MAX_ISSUES — too large to apply unreviewed"

# ── refuse as a unit, before the first write ───────────────────────────────
# Every number must appear in the discussion BODY. A number that reached the
# plan from a comment is either a hallucination or an injection; both look the
# same from here and both are refused.
BODY=$(jq -r '.body' "$THREAD")
for n in "${WANT[@]}"; do
  grep -qE "(^|[^0-9])#$n([^0-9]|$)" <<<"$BODY" || fail "#$n is not in the discussion body"
done

[ "$(printf '%s\n' "${WANT[@]}" | sort -u | wc -l)" -eq "${#WANT[@]}" ] || fail "plan repeats an issue number"

declare -A CURRENT
for n in "${WANT[@]}"; do
  meta=$(gh api "repos/$REPO/issues/$n" --jq '[.state, (.pull_request != null), (.milestone.title // "")] | @tsv' 2>/dev/null) \
    || fail "#$n does not exist in $REPO"
  IFS=$'\t' read -r state is_pr ms <<<"$meta"
  [ "$state" = "open" ]  || fail "#$n is $state — the discussion is stale, edit it rather than applying it"
  [ "$is_pr" = "false" ] || fail "#$n is a pull request"
  # An issue already on another milestone is somebody else's plan. Moving it
  # silently is the one mistake with no trace, so refuse and let a human decide.
  [ -z "$ms" ] || [ "$ms" = "$MILESTONE" ] || fail "#$n is already on milestone '$ms'"
  CURRENT[$n]="$ms"
done

# ── resolve or create the milestone ────────────────────────────────────────
NUMBER=$(gh api "repos/$REPO/milestones?state=all&per_page=100" --jq \
  --arg t "$MILESTONE" 'map(select(.title == $t)) | first | .number // empty')
CREATED=false
if [ -n "$NUMBER" ]; then
  # Adopt, never PATCH. A description or due date on an existing milestone is a
  # human's edit; overwriting it from a discussion is not this job's business.
  echo "Adopting existing milestone $MILESTONE (#$NUMBER)"
else
  NUMBER=$(gh api -X POST "repos/$REPO/milestones" -f title="$MILESTONE" \
    -f description="Assembled from discussion #$NUM by @$ACTOR." --jq .number)
  CREATED=true
  echo "Created milestone $MILESTONE (#$NUMBER)"
fi

# ── write ──────────────────────────────────────────────────────────────────
CHANGES='[]'; SKIPPED='[]'; FAILED=0
for n in "${WANT[@]}"; do
  if [ "${CURRENT[$n]}" = "$MILESTONE" ]; then
    echo "#$n milestone: $MILESTONE -> $MILESTONE [SKIP already]"
    SKIPPED=$(jq -c --argjson i "$n" '. + [$i]' <<<"$SKIPPED")
    continue
  fi
  if gh api -X PATCH "repos/$REPO/issues/$n" -F milestone="$NUMBER" >/dev/null; then
    echo "#$n milestone: (none) -> $MILESTONE [OK]"
    CHANGES=$(jq -c --argjson i "$n" '. + [$i]' <<<"$CHANGES")
  else
    echo "::warning::#$n assignment failed"
    FAILED=$((FAILED + 1))
  fi
  sleep 1   # secondary rate limits return 403s that read like permission errors
done

# ── say what happened, with enough to undo it ──────────────────────────────
# The manifest is scoped to this run's own writes. A naive undo — "clear this
# milestone from everything that has it" — would strip issues that were already
# there before the run, which is why `created` and the changed list both matter.
MANIFEST=$(jq -nc --arg m "$MILESTONE" --argjson num "$NUMBER" --argjson c "$CREATED" \
  --argjson ch "$CHANGES" --argjson sk "$SKIPPED" \
  '{milestone:$m, number:$num, created:$c, changed:$ch, skipped:$sk}')

{
  echo "<!-- discussion-milestone:v1 -->"
  echo "Applied this discussion to milestone **$MILESTONE**, as asked by @$ACTOR."
  echo
  echo "- assigned: $(jq -r 'if length == 0 then "none" else map("#\(.)") | join(", ") end' <<<"$CHANGES")"
  echo "- already there: $(jq -r 'if length == 0 then "none" else map("#\(.)") | join(", ") end' <<<"$SKIPPED")"
  jq -r '.excluded // [] | if length == 0 then empty else "- left off: " + (map("#\(.number) (\(.reason))") | join(", ")) end' "$PLAN"
  echo
  jq -r '.notes // empty' "$PLAN"
  echo
  echo "<details><summary>Reversal manifest</summary>"
  echo; echo '```json'; echo "$MANIFEST"; echo '```'
  echo; echo "</details>"
} > comment.md

gh api graphql -F body=@comment.md -F id="$(jq -r '.id // empty' "$THREAD")" \
  -f query='mutation($id:ID!,$body:String!){addDiscussionComment(input:{discussionId:$id,body:$body}){comment{url}}}' \
  --jq '.data.addDiscussionComment.comment.url' 2>/dev/null \
  || gh api "repos/$REPO/issues/$NUM/comments" -F body=@comment.md --jq .html_url

[ "$FAILED" -eq 0 ] || fail "$FAILED assignment(s) failed — re-run to converge"
