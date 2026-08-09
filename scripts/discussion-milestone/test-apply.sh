#!/usr/bin/env bash
# Runnable check for apply.sh — fixtures only, no network, no CI.
#
#   scripts/discussion-milestone/test-apply.sh
#
# The refusal set is the entire security argument of this workflow, so its
# failing paths get executed rather than reasoned about. `gh` is replaced with a
# fixture-backed stub on PATH: every refusal below is decided before the stub is
# ever consulted, except the ones that are *about* live issue state.
set -uo pipefail
cd "$(dirname "$0")"
APPLY="$PWD/apply.sh"

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
# two concatenated arrays == what `gh api --paginate` actually emits
printf '[{"title":"v1.0","number":1},{"title":"v1.1","number":2}]\n[{"title":"v1.2","number":3}]\n' \
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
  '{id:"D_abc", number:1598, title:"Release v1.2 planning", body:$b, locked:$l}'; }
thread       > "$T/run/thread.json"
thread true  > "$T/run/locked.json"

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

echo "5. a locked discussion is refused before any write"
out=$(run '[1484]' locked.json); rc=$?
[ $rc -ne 0 ] || { echo "$out"; fail "a locked discussion must be refused"; }
grep -q "is locked" <<<"$out" || { echo "$out"; fail "wrong reason"; }
grep -q "\[OK\]" <<<"$out" && fail "refused, but only AFTER writing"
echo "   ✓ refused, with nothing assigned"

echo "6. a missing environment variable names itself"
for v in REPO NUM ACTOR; do
  printf '[1484]' > "$T/run/plan.json"
  out=$( cd "$T/run" && REPO=x NUM=1 ACTOR=y \
           bash -c 'unset "$1"; exec bash "$2" plan.json thread.json' _ "$v" "$APPLY" 2>&1 ); rc=$?
  [ $rc -ne 0 ] || fail "$v unset should fail"
  grep -q "$v must be set" <<<"$out" || { echo "$out"; fail "$v unset gave a bare unbound-variable error"; }
done
echo "   ✓ REPO / NUM / ACTOR each fail with a sentence, not 'unbound variable'"

echo "ALL CHECKS PASSED"
