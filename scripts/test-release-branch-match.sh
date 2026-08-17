#!/usr/bin/env bash
# Runnable check for release-branch-match.sh — real git, no network, no CI.
#
#   scripts/test-release-branch-match.sh
#
# Builds a throwaway repo with a bare "origin", two release lines and a main,
# then drives every outcome the gate is supposed to have an opinion about. A
# release gate whose failing paths have never been executed is not a gate.
set -uo pipefail
cd "$(dirname "$0")"
GUARD="$PWD/release-branch-match.sh"

T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
q() { git "$@" >/dev/null 2>&1; }

# ── a bare origin + a working clone ──────────────────────────────────────────
q init --bare "$T/origin.git"
q clone "$T/origin.git" "$T/work"
cd "$T/work"
q config user.email t@example.com; q config user.name t

commit() { echo "$1" > f; q add f; q commit -m "$1"; git rev-parse HEAD; }

BASE=$(commit base)
q push origin HEAD:refs/heads/main

# rel/1.0 with a release on it
q checkout -b rel/1.0
R10=$(commit "on rel/1.0")
q push origin rel/1.0

# rel/1.1 forked from base, with its own commit
q checkout -b rel/1.1 "$BASE"
R11=$(commit "on rel/1.1")
q push origin rel/1.1

# a commit that lives only on main — no release line at all
q checkout -b main-only "$BASE"
MAINONLY=$(commit "main only")
q push origin main-only:refs/heads/main --force

run_at() { q checkout --detach "$1"; bash "$GUARD" "$2" 2>&1; }

echo "1. a v1.1.x tag on rel/1.1 passes"
out=$(run_at "$R11" v1.1.4); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "should have passed"; }
grep -q "OK: v1.1.4 is contained in rel/1.1" <<<"$out" || { echo "$out"; fail "wrong success message"; }
echo "   ✓ $(grep -o 'OK:.*' <<<"$out")"

echo "2. the SAME commit tagged v1.0.x is REJECTED — this is the whole point"
out=$(run_at "$R11" v1.0.4); rc=$?
[ $rc -ne 0 ] || { echo "$out"; fail "a v1.0.x tag on rel/1.1 must fail"; }
grep -q "is not contained in rel/1.0" <<<"$out" || { echo "$out"; fail "wrong rejection reason"; }
grep -q "Branches that DO contain this commit" <<<"$out" || fail "should list the real branches"
echo "   ✓ rejected, and reported where the commit actually lives"

echo "3. a patch release on the same line passes (PATCH is not part of the branch)"
out=$(run_at "$R11" v1.1.99); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "v1.1.99 should ship from rel/1.1"; }
echo "   ✓ v1.1.99 -> rel/1.1"

echo "4. a pre-release tag derives the same line"
out=$(run_at "$R11" v1.1.0-rc.1); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "v1.1.0-rc.1 should ship from rel/1.1"; }
echo "   ✓ v1.1.0-rc.1 -> rel/1.1"

echo "5. an ancestor of the branch tip passes (tag need not be the tip)"
out=$(run_at "$BASE" v1.1.0); rc=$?
[ $rc -eq 0 ] || { echo "$out"; fail "an ancestor of rel/1.1 should pass"; }
echo "   ✓ ancestry, not tip-equality"

echo "6. a commit on no release line at all is rejected"
out=$(run_at "$MAINONLY" v1.1.0); rc=$?
[ $rc -ne 0 ] || { echo "$out"; fail "a main-only commit must not release"; }
grep -q "is not contained in rel/1.1" <<<"$out" || { echo "$out"; fail "wrong reason"; }
echo "   ✓ main-only commit refused"

echo "7. a version whose release line was never cut is a hard failure, not a skip"
out=$(run_at "$R11" v9.9.0); rc=$?
[ $rc -ne 0 ] || { echo "$out"; fail "a nonexistent rel/9.9 must fail"; }
grep -q "which does not exist" <<<"$out" || { echo "$out"; fail "wrong reason: $out"; }
echo "   ✓ missing release line refused"

echo "8. a malformed tag is refused before any git work"
for bad in v1.1 1.1.0 release-1.1.0 v1..0; do
  out=$(run_at "$R11" "$bad"); rc=$?
  [ $rc -ne 0 ] || fail "tag '$bad' should be refused"
  grep -q "is not vMAJOR.MINOR.PATCH" <<<"$out" || fail "tag '$bad' failed for the wrong reason"
done
echo "   ✓ v1.1 / 1.1.0 / release-1.1.0 / v1..0 all refused"

echo "ALL CHECKS PASSED"
