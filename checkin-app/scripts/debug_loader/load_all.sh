#!/usr/bin/env bash
#
# Load every data/*.json fixture through load_debug_data.py in dependency order.
# Stops on the first failure (set -e) so a broken tool load doesn't cascade into
# certs that reference missing tools.
#
# Order matters:
#   tools          first  — certifications reference tools by name
#   programs       before enrollments — enrollments reference programs by name
#   past_programs  before enrollments — the enrolled program names live here
#   certifications after tools
#   enrollments    after both program files
#   visits         last (persona-only, no fixture deps)
#
# Extra args pass through to the loader, applied to EVERY file, e.g.:
#   ./load_all.sh
#   ./load_all.sh --base-url http://localhost:3010
#
# Personas are seeded (npx tsx prisma/seed.ts); the loader logs in as a sysadmin
# by default, which can create programs/tools/certs and comp-enroll.
set -euo pipefail
cd "$(dirname "$0")"

FILES=(
  data/tools.json
  data/programs.json
  data/past_programs.json
  data/certifications.json
  data/enrollments.json
  data/attendance_visits.json
  data/visits_history.json
)

# Drift guard: warn about any data/*.json we don't list, so a newly-added fixture
# isn't silently skipped by a wrapper whose whole job is "load them all".
for f in data/*.json; do
  case " ${FILES[*]} " in
    *" $f "*) ;;
    *) echo "WARN: $f is not in the load order — add it to FILES in $0" >&2 ;;
  esac
done

for f in "${FILES[@]}"; do
  echo "==> $f"
  python3 load_debug_data.py "$f" "$@"
done

echo "All fixtures loaded."
