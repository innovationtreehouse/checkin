#!/usr/bin/env bash
# Release migration gate — run by deploy-prod.yml from the checked-out
# released tag, with full history + tags fetched. Usage:
#
#   scripts/release-migration-gate.sh <released-tag>
#
# Enforces the two release/migration invariants (and prints an audit):
#
#   RULE 1 — AT MOST ONE prisma migration between tags. A release applies at
#     most one new migration directory relative to the previous v* release.
#     Two schema merges accumulated on main? Cut an interim release targeted
#     at the commit after the first one (gh release create vX --target <sha>),
#     then release the second. Coalescing before a release is NOT the fix —
#     see RULE 2.
#
#   RULE 2 — NOTHING SWEPT UNRELEASED. Every migration added anywhere in the
#     window must still exist at the released tag. A coalesce that sweeps an
#     unreleased migration erases DDL prod has never run, while its ledger
#     reconcile marks it applied — silent schema loss. An endpoint diff cannot
#     see added-then-swept-inside-the-window, so this walks the commits.
#
# Exit codes: 0 = pass (or first release: nothing to gate), 1 = violation.
# Tested by scripts/__tests__/release-migration-gate.test.ts on scratch repos.
set -euo pipefail

CURRENT_TAG="${1:?usage: release-migration-gate.sh <released-tag>}"
MIG_DIR="checkin-app/prisma/migrations"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

# ── Resolve the previous v* release tag (version sort, not lexical). ─────────
mapfile -t TAGS < <(git tag -l 'v*' | sort -V)
PREV_TAG=""
FOUND=""
for i in "${!TAGS[@]}"; do
    if [ "${TAGS[$i]}" = "$CURRENT_TAG" ]; then
        FOUND=1
        if [ "$i" -gt 0 ]; then PREV_TAG="${TAGS[$((i - 1))]}"; fi
        break
    fi
done
if [ -z "$FOUND" ]; then
    echo "::error::Released tag $CURRENT_TAG not found in the fetched tag list — fetch tags before running the gate."
    exit 1
fi
if [ -z "$PREV_TAG" ]; then
    echo "First v* release ($CURRENT_TAG) — no previous tag to gate against. Skipping."
    exit 0
fi
echo "Gating $PREV_TAG..$CURRENT_TAG"

# ── Audit: migration dirs this release adds (one per schema-bearing merge). ──
# Directories, not files (a dir holds migration.sql and possibly
# reconcile.sql). --no-renames: a rewritten baseline must never be mistaken
# for a rename of a migration it replaces.
mapfile -t ADDED < <(git diff --no-renames --name-status "$PREV_TAG"..HEAD -- "$MIG_DIR" |
    awk '$1=="A" {print $2}' | awk -F/ 'NF>=5 {print $4}' | sort -u)
{
    echo "### Migrations audit ($PREV_TAG → $CURRENT_TAG)"
    echo "New migration directories: ${#ADDED[@]}"
    for d in "${ADDED[@]}"; do echo "- \`$d\`"; done
} >>"$SUMMARY"
echo "New migration dir(s) since $PREV_TAG (${#ADDED[@]}): ${ADDED[*]:-none}"

# ── RULE 1: at most one migration between tags. ──────────────────────────────
if [ "${#ADDED[@]}" -gt 1 ]; then
    echo "::error::RULE 1: this release would apply ${#ADDED[@]} new migrations (${ADDED[*]}) — a release may apply at most ONE. Cut an interim release targeted at the commit after the first migration (gh release create vX --target <sha>), then release the rest. Do NOT coalesce unreleased migrations (RULE 2)."
    exit 1
fi

# ── RULE 2: nothing swept unreleased (commit-walk; endpoint diffs are blind
#    to added-then-swept-inside-the-window). ──────────────────────────────────
mapfile -t WINDOW_ADDED < <(git log --no-renames --diff-filter=A --name-only --format= "$PREV_TAG"..HEAD -- "$MIG_DIR" |
    awk -F/ 'NF>=5 {print $4}' | sort -u)
MISSING=()
for d in "${WINDOW_ADDED[@]}"; do
    [ -d "$MIG_DIR/$d" ] || MISSING+=("$d")
done
if [ "${#MISSING[@]}" -gt 0 ]; then
    echo "::error::RULE 2: migration(s) ${MISSING[*]} were merged after $PREV_TAG but are GONE at $CURRENT_TAG — a coalesce swept unreleased work. Prod (at $PREV_TAG) never ran their DDL, and the ledger reconcile would mark it applied anyway. Only coalesce migrations already contained in a release (MIGRATION_COALESCE_FLOW.md, 'The tag rule')."
    exit 1
fi

echo "OK — at most one new migration, and nothing merged since $PREV_TAG was swept."
