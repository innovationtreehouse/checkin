# Migration Coalesce Flow

## Policy

Every PR that needs a schema change adds its own migration, same as always
— but **a release may apply at most ONE prisma migration between tags**,
enforced by `scripts/release-migration-gate.sh` in `deploy-prod.yml` (RULE 1).
If two schema PRs merge before a release ships the first, do NOT coalesce
them — cut an **interim release targeted at the commit after the first
migration** (`gh release create vX --target <sha>`), then release the second.

**Coalescing is post-release hygiene**: after a release ships,
`scripts/coalesce-migrations.ts` may squash history into a single baseline —
but it may only sweep migrations **already contained in the latest `v*`
release** ("the tag rule", below; RULE 2 of the release gate, and enforced
earlier at PR time by `migration-safety.yml`). Coalescing *before* a release
sweeps migrations prod has never applied, and the ledger reconcile would mark
their DDL applied without running it — silent schema loss.

### The tag rule

A coalesce baseline's `reconcile.sql` rewrites an environment's ledger to
"baseline applied" **without running any DDL** — which is only truthful if
that environment already applied every swept migration. Dev always has
(it migrates on every merge). **Prod sits at the last release tag** — so a
coalesce that sweeps an unreleased migration would, after reconcile, leave
prod's ledger claiming DDL that never ran there: silent schema loss that
surfaces as runtime errors. Therefore: **only coalesce migrations reachable
from the latest `v*` tag** — practically, run the coalesce right after a
release, never right before one. `migration-safety.yml` fails any coalesce
PR that sweeps a migration absent from the latest release tag.

```
 PR merges to main            a coalesce PR                  a release
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│ migration A       │         │ scripts/          │         │ deploy-prod.yml  │
│ migration B       │  --->   │ coalesce-         │  --->   │ release gate:    │
│ migration C       │         │ migrations.ts     │         │ "added migration │
│ ...accumulate...  │         │ deletes A..N,     │         │  dirs since prev │
│ migration N       │         │ adds ONE baseline │         │  release <= 1"   │
└──────────────────┘         └──────────────────┘         └──────────────────┘
```

This repo hit both failure modes this policy exists to prevent, in the same
week: #791 (Prisma generated a rename as DROP+ADD, wedging a populated DB
mid-deploy) and #792, which manually squashed 49 accumulated migrations into
one baseline by hand ahead of a release — real, but slow and error-prone
(see "What #792 got right, by hand" below). This flow scripts and gates that
same shape of work.

Related docs: `.github/workflows/migration-safety.yml` (origin #794, the
populated-DB migration check this flow adds a second path to) and
`DEPLOY_MIGRATION_ORDER_OF_OPERATIONS.md` (#933) — that doc covers the general
deploy/migration sequencing rules (expand/cutover/contract); this one is
specifically the coalesce-before-release mechanics.

## When to run it

**After** a release, when the released chain has grown long enough to be
worth squashing. Check what the latest release contains:

```bash
git fetch origin main --tags
git ls-tree --name-only $(git tag -l 'v*' | sort -V | tail -1) -- checkin-app/prisma/migrations/
```

Everything listed there is fair game to sweep; anything merged after that
tag is NOT (the tag rule) — CI will reject a coalesce PR that touches it.

## Running the script

```bash
cd checkin-app
DATABASE_URL_SCRATCH=postgresql://prisma:prismapassword@localhost:5433/postgres \
  npx tsx scripts/coalesce-migrations.ts
```

Defaults to a **dry run**: builds and validates the candidate baseline,
writes nothing. Add `--commit` to actually replace `prisma/migrations/*`
with it and write the reconcile artifacts.

Flags / env:
- `--scratch-url <postgres-url>` or `DATABASE_URL_SCRATCH` (required) — a
  disposable Postgres server/maintenance DB, e.g. `.../postgres` on a scratch
  instance. The script creates and always drops its own temp DBs there
  (`coalesce_truth_*`, `coalesce_candidate_*`) and refuses to run at all if
  the URL's own database name is `checkmein`, `checkin_dev`, or
  `checkin_prod` — it never touches a real environment database.
- `--commit` — write the coalesced baseline + `reconcile.sql`. Without it,
  nothing in the repo changes.

### What it does

1. **Preflight**: clean git tree, on a branch (not detached HEAD), scratch
   URL present and not pointed at a real environment.
2. **Build TRUTH**: a fresh temp DB gets the full current migration chain
   applied (`prisma migrate deploy`).
3. **Generate candidate**: `prisma migrate diff --from-empty
   --to-schema=prisma/schema.prisma --script` into a single migration named
   `<timestamp>_coalesced_baseline`.
4. **Validate**:
   - Semantic schema identity: TRUTH's schema and a fresh DB with only the
     candidate applied must dump the same schema
     (`scripts/compare-schema-dumps.sh`, order-insensitive, ignoring pg_dump
     noise and cosmetic `*_id_seq` naming — see that script and
     `scripts/lib/schema-dump-compare.ts` for exactly what "noise" means).
   - **Partial unique indexes**: Prisma's schema DSL cannot express a
     `WHERE` clause, so `migrate diff --from-empty` has nothing in
     `schema.prisma` to reconstruct one from and drops it silently. This
     repo has three (`Visit_one_open_per_participant`,
     `membership_one_inflight_initial`, `membership_one_inflight_renewal`).
     The script diffs TRUTH's `pg_indexes` against the candidate's; anything
     missing gets spliced back in verbatim from TRUTH and the candidate is
     re-validated from scratch. A same-named index with a *different*
     definition is a real divergence, not a diff-tool gap — the script fails
     loud instead of patching over it.
   - **No drift**: `prisma migrate diff --from-config-datasource
     --to-schema=prisma/schema.prisma --exit-code` against the candidate DB
     must be empty.
5. **On `--commit`**: deletes every existing migration directory, writes the
   one baseline (`migration.sql` + `reconcile.sql`), and prints the reconcile
   instructions (below). Temp DBs are always dropped, success or failure.

Unit tests for the pure parts (`scripts/__tests__/schema-dump-compare.test.ts`,
`scripts/__tests__/partial-indexes.test.ts`) cover normalization and
splicing without a database. The DB-orchestration path itself is proven by
actually running the script — see "Dry-run evidence" in the PR that added
this flow.

## Reconcile procedure (dev / prod)

`prisma`'s ledger (`_prisma_migrations`) records one row per applied
migration, keyed by name, with a `checksum` = **sha256 hex of the
migration.sql file** and `applied_steps_count = 1` for a clean apply
(verified against this repo's own ledger while building this flow). An
environment that already ran the migrations a coalesce baseline replaces
needs its ledger reconciled to match the new baseline, or its next `prisma
migrate deploy` looks for migrations that no longer exist in the repo and
fails.

`--commit` writes `prisma/migrations/<baseline>/reconcile.sql`:

```sql
BEGIN;
DELETE FROM "_prisma_migrations";
INSERT INTO "_prisma_migrations"
    (id, checksum, migration_name, started_at, finished_at, applied_steps_count)
VALUES
    (gen_random_uuid(), '<sha256 of migration.sql>', '<baseline name>', now(), now(), 1);
COMMIT;
```

**Convention**: this file always lives at
`prisma/migrations/<baseline-name>/reconcile.sql`, committed alongside the
baseline in the coalesce PR. The CI coalesce path (below) checks for it at
exactly this path.

### Applying it — the ECS one-off pattern

Both `deploy-dev.yml` and `deploy-prod.yml` already run migrations via a
one-off ECS task (`checkin-migrate-dev` / `checkin-migrate-prod`) that
overrides the container command. Reconcile the same way, once the relevant
image (built from a commit that includes the merged baseline) exists in ECR:

```bash
# dev
aws ecs run-task \
  --cluster checkin-dev \
  --task-definition checkin-migrate-dev \
  --network-configuration '<copy from the service, see deploy-dev.yml>' \
  --overrides '{"containerOverrides":[{"name":"checkin-migrate","command":
    ["sh","-c","cd checkin-app && npx prisma db execute --file prisma/migrations/<baseline>/reconcile.sql"]}]}'

# prod
aws ecs run-task \
  --cluster treehouse-prod \
  --task-definition checkin-migrate-prod \
  --capacity-provider-strategy capacityProvider=treehouse-prod-c6g,weight=1 \
  --overrides '{"containerOverrides":[{"name":"checkin-migrate","command":
    ["sh","-c","cd checkin-app && npx prisma db execute --file prisma/migrations/<baseline>/reconcile.sql"]}]}'
```

`prisma db execute --file` (not `psql`) because the migrate image ships
Prisma but not necessarily a `psql` binary, and the file already lives inside
the image at that path once built from the merged commit.

**Two honest paths — both are real, pick based on timing:**

1. **Preemptive.** Dev auto-deploys on every merge to main
   (`deploy-dev.yml`). Run the one-off reconcile task in the narrow
   merge → deploy window, before the automatic migrate step gets there. For
   prod, the equivalent window is between merging the coalesce PR and
   cutting the release — reconcile prod before running `gh release create`.
2. **Reactive (simpler, still correct).** Skip the race. Let the automatic
   migrate step fail once — loudly, expectedly, because it can't find the
   old chain in the ledger (`P3005`-shaped failure, not silent corruption).
   Run the one-off reconcile task against the now-pushed image, then re-run
   the failed GitHub Actions job (dev) or the failed workflow run (prod —
   re-running reuses the same release tag/event). The retry's migrate step
   now finds the ledger already at the new baseline and applies nothing new.

Neither path is automated into the pipeline — reconciling a ledger is a
one-time, per-environment, human-triggered action tied to exactly one
coalesce merge, not something worth building always-on machinery for.

## CI coalesce path (`migration-safety.yml`)

The existing job replays a PR's new migrations on top of a **populated** DB
cloned from the base commit — the right test for an ordinary migration PR,
and structurally impossible for a coalesce PR: a coalesce PR **deletes** the
whole chain that populated DB already has applied, so there's nothing to
"apply on top of."

The job detects a coalesce PR by shape: the diff vs `origin/main`'s merge
base **deletes ≥2 migration directories and adds exactly 1** (the exact
shape `coalesce-migrations.ts` produces). When detected, it runs a different
check instead of the normal replay:

1. The base checkout's full migration chain still gets applied + seeded into
   the service DB, same as the normal path — that DB's schema stands in for
   "the full chain," no separate database needed.
2. The PR's single baseline gets applied to a second, fresh DB.
3. `scripts/compare-schema-dumps.sh` (the same script `coalesce-migrations.ts`
   uses locally) checks the two are schema-identical.
4. The job checks `prisma/migrations/<baseline>/reconcile.sql` exists at the
   documented path.

Normal PRs are unaffected — same steps, same conditions as before shape
detection was added.

## Release gate (`deploy-prod.yml`)

`scripts/release-migration-gate.sh <released-tag>` — a standalone, reviewed
script (unit-tested on scratch repos by
`scripts/__tests__/release-migration-gate.test.ts`), run by the
`migration-release-gate` job from the checked-out released tag. `deploy`
needs both this job and `validate` (which is a reusable-workflow call with
no step surface to extend). It:

1. Resolves the previous `v*` tag (`sort -V` — real version order) and
   prints an **audit** of the migration directories this release adds to
   the run summary. First release: nothing to gate; passes.
2. **RULE 1** — fails if more than one migration directory was added
   between the tags (remediation: an interim release, not a coalesce).
3. **RULE 2** — commit-walks the window (`git log --diff-filter=A`) and
   fails if any migration added since the previous release is *gone* at the
   released tag: a coalesce swept unreleased work. An endpoint diff is
   structurally blind to added-then-swept — the walk is not.
