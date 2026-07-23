#!/usr/bin/env bash
# PreToolUse(Bash) guard for safe jest invocation.
# Blocks 3 recurring, mechanically-detectable failure shapes (see .claude/skills/jest-run).
# Exit 2 + stderr => Claude Code blocks the tool call and feeds stderr back as the reason.
# Anything not matched exits 0 (allow). Never blocks non-test commands.
set -euo pipefail

payload="$(cat)"

# jq is present in this repo's toolchain; fall back to allow if somehow absent.
if ! command -v jq >/dev/null 2>&1; then exit 0; fi

cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')"
bg="$(printf '%s' "$payload"  | jq -r '.tool_input.run_in_background // false')"
[ -z "$cmd" ] && exit 0

# A real test invocation: jest/npx jest at a command boundary, or an npm/yarn/pnpm
# test script, or a test:* script name. Deliberately does NOT match "jest" as a bare
# substring (e.g. `cat jest-notes.md`) so file names with "jest" in them are safe.
is_test_cmd() {
  printf '%s' "$cmd" | grep -Eq \
    '(^|[;&|]|&&|\bnpx[[:space:]]+)[[:space:]]*jest\b|\b(npm|yarn|pnpm)[[:space:]]+(run[[:space:]]+)?test\b|\btest:(ci|integration|coverage|flow)\b'
}

deny() {
  echo "BLOCKED by jest-guard: $1" >&2
  echo "See .claude/skills/jest-run/SKILL.md for the safe form." >&2
  exit 2
}

is_test_cmd || exit 0

# (1) Background test run: hides hangs; user has explicitly banned this.
# Best-effort: only fires if the harness passes run_in_background through to stdin.
if [ "$bg" = "true" ]; then
  deny "test command with run_in_background:true. Run it in the FOREGROUND with a long timeout. Backgrounded test output buffers and hides hangs."
fi

# (2) Piping a test command through tail/head: buffers output until exit, so a hang
# looks like an empty stream the whole time.
if printf '%s' "$cmd" | grep -Eq '\|[[:space:]]*(tail|head)\b'; then
  deny "test command piped through tail/head. Piped output buffers until exit and hides hangs. Redirect to a file (> out.log 2>&1) and Read the file instead."
fi

# (3) Hand-rolled --testPathIgnorePatterns on the CLI: the flag is variadic and REPLACES
# jest's entire config ignore array, pulling the excluded integration+flow tests back in
# (5-16 min hang vs a dead server). Narrow with ONE --testPathPatterns <regex> instead.
if printf '%s' "$cmd" | grep -Eq -- '--testPathIgnorePatterns'; then
  deny "hand-rolled --testPathIgnorePatterns REPLACES jest's config ignore array (drops the integration/flow/worktree excludes). To narrow scope, append ONE '--testPathPatterns <regex>' or use the package.json script verbatim."
fi

exit 0
