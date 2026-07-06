#!/usr/bin/env bash
# Dumps two Postgres databases (--schema-only) and reports whether they are
# semantically identical — ignoring pg_dump noise (comments/SET lines/
# \restrict tokens), column/enum declaration order, and cosmetic *_id_seq
# naming (see scripts/lib/schema-dump-compare.ts for why those are noise, not
# signal). The actual normalize+diff logic lives there so it's jest-unit-
# testable; this wrapper just supplies the two dumps.
#
# Shared by .github/workflows/migration-safety.yml (validates a coalesce PR's
# single baseline against the pre-coalesce chain) and
# checkin-app/scripts/coalesce-migrations.ts (validates its generated
# candidate against a from-scratch TRUTH DB) — one comparison, one behavior,
# used identically in CI and locally.
#
# Usage: compare-schema-dumps.sh <database-url-a> <database-url-b>
# Exit codes: 0 identical, 1 different, 2 usage/tool error.
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <database-url-a> <database-url-b>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# _prisma_migrations is Prisma's own ledger bookkeeping, not app schema — a DB
# that ever ran `migrate deploy` has it, a DB seeded via raw `psql -f` doesn't.
# Excluding it keeps the comparison about the schema, not how each side was built.
pg_dump "$1" --schema-only --no-owner --no-privileges --exclude-table=_prisma_migrations > "$TMP_DIR/a.sql"
pg_dump "$2" --schema-only --no-owner --no-privileges --exclude-table=_prisma_migrations > "$TMP_DIR/b.sql"

cd "$SCRIPT_DIR/.."
npx tsx scripts/lib/schema-dump-compare.ts "$TMP_DIR/a.sql" "$TMP_DIR/b.sql"
