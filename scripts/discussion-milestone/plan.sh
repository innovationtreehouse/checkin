#!/usr/bin/env bash
# Ask Claude which issues the discussion agreed on. Text in, a JSON array of
# integers out.
#
# The model gets no tools and no token, so a fully-injected thread can only
# produce a bad list of numbers — which apply.sh is built to reject. The thread
# reaches the API as DATA inside a jq-built request body; it is never spliced
# into a command line or a workflow expression.
#
# Every failure here aborts before apply.sh runs, so a bad answer is a failed
# run rather than a wrong milestone.
set -euo pipefail

THREAD="${1:?usage: plan.sh <thread.json> <plan.json>}"
OUT="${2:?}"
: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY must be set}"
DIR="$(cd "$(dirname "$0")" && pwd)"

fail() { echo "::error::$*"; exit 1; }

REQ=$(mktemp); RES=$(mktemp)
trap 'rm -f "$REQ" "$RES"' EXIT

# --rawfile, not shell interpolation: the thread is a JSON string value, so a
# comment containing a quote, a backslash or </discussion_thread> is inert.
#
# max_tokens covers thinking AND the answer — claude-opus-5 thinks by default —
# so the budget is far above what 25 integers need. Truncation is caught below.
jq -n --rawfile p "$DIR/prompt.md" --rawfile t "$THREAD" '{
  model: "claude-opus-5",
  max_tokens: 8192,
  system: $p,
  messages: [{role: "user", content: "<discussion_thread>\n\($t)\n</discussion_thread>"}]
}' > "$REQ"

CODE=$(curl -sS --max-time 300 --retry 2 -o "$RES" -w '%{http_code}' \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  --data-binary @"$REQ" \
  https://api.anthropic.com/v1/messages) || fail "the planner API call did not complete"

[ "$CODE" = 200 ] \
  || fail "the planner API returned HTTP $CODE: $(jq -r '.error.message? // "no message"' "$RES" 2>/dev/null || echo 'unparseable body')"

jq -e 'type == "object" and .type == "message"' "$RES" >/dev/null 2>&1 \
  || fail "the planner API returned a body that is not a message"

# Anything other than end_turn means the answer is partial or withheld:
# max_tokens truncated it, refusal declined it. Neither is safe to apply.
STOP=$(jq -r '.stop_reason // "none"' "$RES")
[ "$STOP" = "end_turn" ] \
  || fail "the planner stopped with '$STOP' rather than finishing — refusing to apply a partial answer"

# Thinking blocks ride along with empty text; take the text blocks only.
jq -er '[.content[]? | select(.type == "text") | .text] | add // empty' "$RES" > "$OUT" \
  || fail "the planner returned no text to parse"

# Fail here rather than in apply.sh so the error names the model, not the
# validator. apply.sh keeps its own copy of this check: it is the boundary, and
# it must hold for any plan.json it is handed.
jq -e 'type == "array" and all(type == "number")' "$OUT" >/dev/null 2>&1 \
  || fail "the planner did not return a JSON array of issue numbers"

echo "Planner returned $(jq -r 'length' "$OUT") issue number(s)."
