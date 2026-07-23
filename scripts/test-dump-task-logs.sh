#!/usr/bin/env bash
# Runnable check for dump-task-logs.sh — stubbed `aws`, no network.
#
#   scripts/test-dump-task-logs.sh
#
# The bug this guards: the old fetch printed the OLDEST 200 events, so a chatty
# task's real error (always last) never appeared. These cases pin that the whole
# stream is printed, in order, and that paging terminates.
set -uo pipefail
cd "$(dirname "$0")"
SCRIPT="$PWD/dump-task-logs.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"; export PATH="$T/bin:$PATH"
fail() { echo "FAIL: $*" >&2; exit 1; }

# Stub: 3 pages of 2 events, then a repeated token (end-of-stream signal).
cat > "$T/bin/aws" <<'EOF'
#!/usr/bin/env bash
tok=""
for ((i=0;i<$#;i++)); do :; done
args=("$@")
for ((i=0;i<${#args[@]};i++)); do [ "${args[$i]}" = "--next-token" ] && tok="${args[$((i+1))]}"; done
case "$FAKE_MODE:$tok" in
  fail:*)      echo "AccessDenied" >&2; exit 254 ;;
  failp2:t1)   echo "Throttled" >&2; exit 254 ;;
esac
case "$tok" in
  "")   echo '{"events":[{"message":"line1"},{"message":"line2"}],"nextForwardToken":"t1"}' ;;
  t1)   echo '{"events":[{"message":"line3"},{"message":"line4"}],"nextForwardToken":"t2"}' ;;
  t2)   echo '{"events":[{"message":"ERROR: the real failure"}],"nextForwardToken":"t2"}' ;;
esac
EOF
chmod +x "$T/bin/aws"

echo "1. prints the ENTIRE stream, in order, including the final page"
out=$(FAKE_MODE=ok "$SCRIPT" grp strm)
n=$(grep -c . <<<"$out")
[ "$n" = "5" ] || { echo "$out"; fail "expected 5 lines, got $n"; }
[ "$(head -1 <<<"$out")" = "line1" ] || fail "first line wrong"
grep -q "ERROR: the real failure" <<<"$out" || fail "the LAST page was not printed — this is the original bug"
echo "   ✓ 5 lines, oldest first, final-page error present"

echo "2. terminates on the repeated forward token (no infinite paging)"
timeout 10 env FAKE_MODE=ok "$SCRIPT" grp strm >/dev/null || fail "did not terminate"
echo "   ✓ returned promptly"

echo "3. a total fetch failure is best-effort, not fatal"
out=$(FAKE_MODE=fail "$SCRIPT" grp strm); rc=$?
[ $rc -eq 0 ] || fail "must exit 0 so logging never fails a deploy (got $rc)"
grep -q "could not fetch logs" <<<"$out" || { echo "$out"; fail "no marker"; }
echo "   ✓ exit 0 with a marker"

echo "4. a mid-stream failure says the output is partial"
out=$(FAKE_MODE=failp2 "$SCRIPT" grp strm); rc=$?
[ $rc -eq 0 ] || fail "must exit 0 (got $rc)"
grep -q "line1" <<<"$out" || fail "should keep what it already read"
grep -q "partial" <<<"$out" || { echo "$out"; fail "should flag partial output"; }
echo "   ✓ keeps partial output and says so"

echo "5. the page cap is enforced and announced"
cat > "$T/bin/aws" <<'EOF'
#!/usr/bin/env bash
n=$RANDOM
echo "{\"events\":[{\"message\":\"x\"}],\"nextForwardToken\":\"t$n\"}"
EOF
chmod +x "$T/bin/aws"
out=$(MAX_LOG_PAGES=3 "$SCRIPT" grp strm)
grep -q "truncated at 3 pages" <<<"$out" || { echo "$out"; fail "cap not announced"; }
echo "   ✓ never-repeating token stops at the cap"

echo "ALL CHECKS PASSED"
