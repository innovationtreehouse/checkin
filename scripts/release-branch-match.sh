#!/usr/bin/env bash
# Assert a release tag ships from its OWN release line: v1.1.x only from rel/1.1.
#
#   scripts/release-branch-match.sh <tag>        # e.g. v1.1.4
#
# WHY: the version and the branch are two independent claims about "which line is
# this", and nothing otherwise makes them agree — so v1.1.0 could be tagged on
# rel/1.0, or on main, and ship to prod carrying a version number that lies about
# its lineage. That is worst exactly when it matters: during an incident, when
# the version string is what people reason about.
#
# Checks ANCESTRY, deliberately not `release.target_commitish`: that field can be
# a branch name OR a bare SHA, is chosen by whoever cut the release, and is
# re-taggable. Containment in the branch is the property we actually care about.
#
# Lives in a script rather than inline in deploy-prod.yml so it can be tested —
# see test-release-branch-match.sh. A release gate that has never been run
# against a failing case is not a gate.
set -euo pipefail

TAG="${1:?usage: release-branch-match.sh <tag>}"
REMOTE="${REMOTE:-origin}"

# v1.1.4, v1.1.4-rc.1, v1.1.4+build -> major 1, minor 1 -> rel/1.1.
# PATCH is deliberately NOT part of the branch name: a release LINE is
# major.minor, and every patch on it ships from that same branch.
if [[ ! "$TAG" =~ ^v([0-9]+)\.([0-9]+)\.[0-9]+ ]]; then
  echo "::error::Release tag '$TAG' is not vMAJOR.MINOR.PATCH — cannot derive its release line." >&2
  exit 1
fi
MAJOR="${BASH_REMATCH[1]}" MINOR="${BASH_REMATCH[2]}"
BRANCH="rel/${MAJOR}.${MINOR}"

SHA="$(git rev-parse HEAD)"
echo "tag ${TAG} -> expected line ${BRANCH} (commit ${SHA})"

# Fetch just that one ref. A missing branch is a hard failure, never a skip:
# "the release line does not exist" is precisely the mistake this catches — a
# typo'd minor, a branch never cut, a branch deleted after the fact.
if ! git fetch --no-tags --quiet "$REMOTE" \
       "+refs/heads/${BRANCH}:refs/remotes/${REMOTE}/${BRANCH}" 2>/dev/null; then
  echo "::error::${TAG} requires branch ${BRANCH}, which does not exist on ${REMOTE}. Cut it first, or fix the tag's version." >&2
  exit 1
fi

# --is-ancestor counts a commit as an ancestor of itself, so a tag sitting ON the
# branch tip passes. Anything not reachable from the branch fails.
if ! git merge-base --is-ancestor "$SHA" "refs/remotes/${REMOTE}/${BRANCH}"; then
  echo "::error::${TAG} (${SHA}) is not contained in ${BRANCH} — a v${MAJOR}.${MINOR}.x release must be cut from that branch." >&2
  echo "Branches that DO contain this commit:" >&2
  git branch -a --contains "$SHA" 2>/dev/null | sed 's/^/  /' >&2 || echo "  (none)" >&2
  exit 1
fi

echo "OK: ${TAG} is contained in ${BRANCH}"
