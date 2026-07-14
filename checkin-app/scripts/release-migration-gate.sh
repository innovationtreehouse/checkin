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
#   RULE 2 — A RECONCILE MAY ONLY STAND IN FOR RELEASED MIGRATIONS. Between
#     tags, dev history is FREE: migrations may be added, reverted, or
#     reworked — prod never saw them and simply applies whatever the tag
#     ships. The one dangerous artifact is a coalesce baseline's
#     reconcile.sql: it rewrites the ledger to "baseline applied" WITHOUT
#     running DDL — only truthful if the baseline replaces exactly what prod
#     already applied: the previous tag's chain. So any commit introducing a
#     reconcile.sql may only delete migration dirs present at the previous tag.
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

# ── RULE 2: reconcile-bearing coalesces may only sweep RELEASED migrations.
#    (Endpoint diffs are blind to added-then-swept-inside-the-window, so this
#    walks the window's commits — but ONLY commits that introduce a
#    reconcile.sql; plain reverts/rework between tags are dev's freedom.) ─────
mapfile -t PREV_DIRS < <(git ls-tree --name-only "$PREV_TAG" -- "$MIG_DIR/" |
    awk -F/ '{print $NF}' | grep -v '^migration_lock.toml$' | sort -u)
mapfile -t COALESCE_COMMITS < <(git log --no-renames --diff-filter=A --format=%H "$PREV_TAG"..HEAD -- "$MIG_DIR/*/reconcile.sql")
for c in "${COALESCE_COMMITS[@]}"; do
    mapfile -t SWEPT < <(git diff-tree --no-renames --name-status -r "$c^" "$c" -- "$MIG_DIR" |
        awk '$1=="D" {print $2}' | awk -F/ 'NF>=5 {print $4}' | sort -u)
    for d in "${SWEPT[@]}"; do
        if ! printf '%s\n' "${PREV_DIRS[@]}" | grep -qxF "$d"; then
            echo "::error::RULE 2: coalesce commit ${c:0:10} sweeps migration '$d', which is NOT in the previous release ($PREV_TAG). Prod never ran its DDL, and the baseline's reconcile.sql would mark it applied anyway — silent schema loss. A reconcile may only stand in for released migrations: coalesce AFTER a release, sweeping only that release's chain (MIGRATION_COALESCE_FLOW.md, 'The tag rule')."
            exit 1
        fi
    done
done

echo "OK — at most one new migration, and every reconcile-bearing coalesce swept only released migrations."
