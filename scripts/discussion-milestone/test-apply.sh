#!/usr/bin/env bash
# Runnable check for plan.sh and apply.sh — fixtures only, no network, no CI.
#
#   scripts/discussion-milestone/test-apply.sh
#
# The refusal set is the entire security argument of this workflow, so its
# failing paths get executed rather than reasoned about. `gh` and `curl` are
# replaced with fixture-backed stubs on PATH: every refusal below is decided
# before the stub is consulted, except the ones that are *about* live issue
# state or *about* what the API returned.
#
# Nothing runs this file automatically — same as the other test-*.sh under
# scripts/ — so the version guard below is the whole defense against it rotting
# unnoticed on a machine where it cannot work.
set -uo pipefail

# apply.sh uses mapfile and declare -A, both bash 4. macOS ships bash 3.2 as
# /bin/bash, where the suite dies mid-check and blames the plan logic for it.
((BASH_VERSINFO[0] >= 4)) || { echo "needs bash 4+ (mapfile, declare -A); macOS ships 3.2" >&2; exit 1; }

cd "$(dirname "$0")"
APPLY="$PWD/apply.sh"
PLAN="$PWD/plan.sh"

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/fix" "$T/run"
fail() { echo "FAIL: $*" >&2; exit 1; }

# ── a `gh` that answers from fixtures ────────────────────────────────────────
cat > "$T/bin/gh" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
args="$*"
case "$args" in
  *"-X POST"*milestones*)  echo 77; exit 0 ;;
  *"-X PATCH"*issues*)     echo '{}'; exit 0 ;;
  *milestones*)            cat "$FIX/milestones.json"; exit 0 ;;
  "api graphql"*)          echo "https://example.test/discussion-comment"; exit 0 ;;
esac
n=${args##*issues/}; n=${n%% *}
jq -e --arg n "$n" 'has($n)' "$FIX/issues.json" >/dev/null 2>&1 || exit 1
jq -r --arg n "$n" '.[$n] | [.state, (.pr|tostring), .milestone] | @tsv' "$FIX/issues.json"
STUB
chmod +x "$T/bin/gh"
export PATH="$T/bin:$PATH" FIX="$T/fix"

# #1484 and #1500 are open and unassigned; #1409 is closed; #1519 is a PR;
# #1600 already belongs to somebody else's milestone. v1.2 exists on PAGE TWO.
cat > "$T/fix/issues.json" <<'JSON'
{ "1484": {"state":"open","pr":false,"milestone":""},
  "1500": {"state":"open","pr":false,"milestone":""},
  "1501": {"state":"open","pr":false,"milestone":"v1.2"},
  "1409": {"state":"closed","pr":false,"milestone":""},
  "1519": {"state":"open","pr":true,"milestone":""},
  "1600": {"state":"open","pr":false,"milestone":"v2.0"} }
JSON
# two concatenated arrays == what `gh api --paginate` actually emits.
# v1.0 has shipped and been closed; v1.2 is open and lives on PAGE TWO.
printf '%s\n%s\n' \
  '[{"title":"v1.0","number":1,"state":"closed"},{"title":"v1.1","number":2,"state":"open"}]' \
  '[{"title":"v1.2","number":3,"state":"open"}]' \
  > "$T/fix/milestones.json"

body='Candidates for v1.2:
- [x] #1484
- [x] #1500
- [ ] #1409
- [ ] #1519
- [ ] #1501
- [ ] #1600
- [ ] #148415'
thread() { jq -n --arg b "$body" --argjson l "${1:-false}" \
  --arg t "${2:-Release v1.2 planning}" \
  '{id:"D_abc", number:1598, title:$t, body:$b, locked:$l}'; }
thread                               > "$T/run/thread.json"
thread true                          > "$T/run/locked.json"
thread false "Release v1.0 planning" > "$T/run/shipped.json"

run() { # run <plan-json> [thread-file]
  printf '%s' "$1" > "$T/run/plan.json"
  ( cd "$T/run" && REPO=innovationtreehouse/checkin NUM=1598 ACTOR=jee7s \
      bash "$APPLY" plan.json "${2:-thread.json}" 2>&1 )
}
refuses() { # refuses <label> <plan> <expected-substring>
  local out; out=$(run "$2"); local rc=$?
  [ $rc -ne 0 ] || { echo "$out"; fail "$1: should have been refused"; }
  grep -qF "$3" <<<"$out" || { echo "$out"; fail "$1: wrong reason (wanted '$3')"; }
  echo "   ✓ $1"
}

echo "1. a valid plan applies, and resolves a milestone that is on page two"
out=$(run '[1484, 1500]'); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "the happy path must pass"; }
grep -q "Adopting milestone v1.2 (#3)" <<<"$out" || { echo "$out"; fail "should adopt existing v1.2 from page 2"; }
grep -q "#1484 (none) -> v1.2 \[OK\]" <<<"$out" || { echo "$out"; fail "should assign #1484"; }
grep -q "example.test/discussion-comment" <<<"$out" || { echo "$out"; fail "should post the result comment"; }
echo "   ✓ adopted v1.2 (#3) past the page boundary, assigned both, commented"

echo "2. an issue already on v1.2 is reported as a skip, not a re-write"
out=$(run '[1501]'); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "already-on-target should succeed"; }
grep -q "#1501 -> v1.2 \[SKIP already\]" <<<"$out" || { echo "$out"; fail "should skip"; }
echo "   ✓ set-if-unset, so a re-run converges"

echo "3. the refusal set"
refuses "a number absent from the body"        '[9999]'            "#9999 is not in the discussion body"
refuses "a closed issue"                       '[1409]'            "#1409 is closed"
refuses "a pull request"                       '[1519]'            "#1519 is a pull request"
refuses "an issue on somebody else's milestone" '[1600]'           "#1600 is already on milestone 'v2.0'"
refuses "in the body, but not a real issue"    '[148415]'          "does not exist"
refuses "an object instead of an array"        '{"issues":[1484],"notes":"hi"}' "did not return a JSON array"
refuses "a string that looks like a number"    '["1484"]'          "did not return a JSON array"
refuses "an empty plan"                        '[]'                "no issues"
refuses "a duplicate number"                   '[1484, 1484]'      "duplicate issue number"
refuses "more issues than the cap" \
  "[$(seq 1 26 | paste -sd, -)]" "exceeds the cap"

echo "4. the numeric guard — a JSON number is not necessarily an issue number"
# 1484.5 is a valid JSON number, and `.` is a regex metacharacter, so without
# the guard it matches #148415 in the body and sails through the membership
# check. Assert the NUMERIC message, not the body one: that pins the guard.
refuses "a float"       '[1484.5]' "'1484.5' is not a number"
refuses "an exponent"   '[1e3]'    "is not a number"
refuses "a negative"    '[-5]'     "'-5' is not a number"
grep -qE "(^|[^0-9])#1484.5([^0-9]|$)" <<<"$body" \
  || fail "fixture no longer demonstrates the metacharacter hole"
echo "   ✓ and #1484.5 really does match #148415 by regex, so the guard is load-bearing"

echo "5. stale inputs are refused before any write"
out=$(run '[1484]' locked.json); rc=$?
[ $rc -ne 0 ] || { echo "$out"; fail "a locked discussion must be refused"; }
grep -q "is locked" <<<"$out" || { echo "$out"; fail "wrong reason"; }
grep -q "\[OK\]" <<<"$out" && fail "refused, but only AFTER writing"
echo "   ✓ a locked discussion, with nothing assigned"

# v1.0 shipped and was closed. Adopting it would quietly add today's issues to a
# released milestone, and creating it is impossible — the title still 422s.
out=$(run '[1484]' shipped.json); rc=$?
[ $rc -ne 0 ] || { echo "$out"; fail "a closed milestone must be refused"; }
grep -q "milestone v1.0 is closed" <<<"$out" || { echo "$out"; fail "wrong reason"; }
grep -q "Adopting" <<<"$out" && fail "adopted a closed milestone"
grep -q "\[OK\]" <<<"$out" && fail "refused, but only AFTER writing"
echo "   ✓ a shipped milestone, named as staleness rather than adopted"

echo "6. a missing environment variable names itself"
for v in REPO NUM ACTOR; do
  printf '[1484]' > "$T/run/plan.json"
  out=$( cd "$T/run" && REPO=x NUM=1 ACTOR=y \
           bash -c 'unset "$1"; exec bash "$2" plan.json thread.json' _ "$v" "$APPLY" 2>&1 ); rc=$?
  [ $rc -ne 0 ] || fail "$v unset should fail"
  grep -q "$v must be set" <<<"$out" || { echo "$out"; fail "$v unset gave a bare unbound-variable error"; }
done
echo "   ✓ REPO / NUM / ACTOR each fail with a sentence, not 'unbound variable'"

# ── the planner: everything the API can hand back that is not an answer ──────
# `curl` answers from a fixture and echoes $HTTP_CODE, matching plan.sh's
# `-o file -w %{http_code}` shape. Nothing here reaches the network.
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -uo pipefail
out=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && out="$a"; prev="$a"; done
cat "$FIX/response.json" > "$out"
printf '%s' "${HTTP_CODE:-200}"
STUB
chmod +x "$T/bin/curl"

# A thinking block rides along in every fixture: claude-opus-5 thinks by
# default, so the extractor has to skip it rather than choke on it.
msg() { jq -nc --arg s "$1" --arg t "$2" \
  '{type:"message", stop_reason:$s,
    content:[{type:"thinking",thinking:""},{type:"text",text:$t}]}'; }

plan() { # plan <http-code> <response-body>
  printf '%s' "$2" > "$T/fix/response.json"
  ( cd "$T/run" && HTTP_CODE="$1" ANTHROPIC_API_KEY=test-key \
      bash "$PLAN" thread.json plan.json 2>&1 )
}
plan_refuses() { # plan_refuses <label> <http-code> <response> <expected-substring>
  local out; out=$(plan "$2" "$3"); local rc=$?
  [ $rc -ne 0 ] || { echo "$out"; fail "$1: should have been refused"; }
  grep -qF "$4" <<<"$out" || { echo "$out"; fail "$1: wrong reason (wanted '$4')"; }
  echo "   ✓ $1"
}

echo "7. the planner hands apply.sh a bare array, and nothing else"
out=$(plan 200 "$(msg end_turn '[1484, 1500]')"); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "the planner happy path must pass"; }
[ "$(cat "$T/run/plan.json")" = "[1484, 1500]" ] \
  || { cat "$T/run/plan.json"; fail "plan.json should be the model's bare array"; }
# The two scripts meet here: apply.sh consumes what plan.sh just wrote.
out=$( cd "$T/run" && REPO=innovationtreehouse/checkin NUM=1598 ACTOR=jee7s \
         bash "$APPLY" plan.json thread.json 2>&1 ); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "apply.sh must accept plan.sh's output"; }
echo "   ✓ thinking block skipped, and apply.sh accepts the file it wrote"

echo "8. the planner refusal set — every one aborts before apply.sh runs"
plan_refuses "a non-200 response" 500 \
  '{"type":"error","error":{"message":"overloaded"}}' "returned HTTP 500"
plan_refuses "a non-200 with an unparseable body" 502 \
  '<html>bad gateway</html>' "returned HTTP 502"
plan_refuses "a 200 that is not a message" 200 \
  '{"detail":"nope"}' "not a message"
plan_refuses "a 200 that is not JSON at all" 200 \
  'not json' "not a message"
plan_refuses "a truncated answer (stop_reason)" 200 \
  "$(msg max_tokens '[1484, 15')" "stopped with 'max_tokens'"
plan_refuses "a truncated answer that still claims to be complete" 200 \
  "$(msg end_turn '[1484, 15')" "did not return a JSON array"
plan_refuses "a refusal" 200 \
  "$(msg refusal 'I cannot help with that.')" "stopped with 'refusal'"
plan_refuses "prose instead of an array" 200 \
  "$(msg end_turn 'The maintainers agreed on #1484.')" "did not return a JSON array"
plan_refuses "an object instead of an array" 200 \
  "$(msg end_turn '{"issues":[1484]}')" "did not return a JSON array"
plan_refuses "a fenced array" 200 \
  "$(msg end_turn '```json
[1484]
```')" "did not return a JSON array"
plan_refuses "no text block to read" 200 \
  '{"type":"message","stop_reason":"end_turn","content":[{"type":"thinking","thinking":""}]}' \
  "no text to parse"

echo "9. an empty plan still dies in apply.sh, not silently"
out=$(plan 200 "$(msg end_turn '[]')"); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "[] is a valid planner answer"; }
out=$( cd "$T/run" && REPO=x NUM=1 ACTOR=y bash "$APPLY" plan.json thread.json 2>&1 ); rc=$?
[ $rc -ne 0 ] || { echo "$out"; fail "an empty plan must fail the run"; }
grep -qF "no issues" <<<"$out" || { echo "$out"; fail "wrong reason"; }
echo "   ✓ 'I cannot tell' ends the run without touching a milestone"

echo "10. a missing API key names itself"
out=$( cd "$T/run" && env -u ANTHROPIC_API_KEY bash "$PLAN" thread.json plan.json 2>&1 ); rc=$?
[ $rc -ne 0 ] || fail "an unset ANTHROPIC_API_KEY should fail"
grep -qF "ANTHROPIC_API_KEY must be set" <<<"$out" \
  || { echo "$out"; fail "unset key gave a bare unbound-variable error"; }
echo "   ✓ fails closed with a sentence — which is what CI does today"

echo "ALL CHECKS PASSED"
