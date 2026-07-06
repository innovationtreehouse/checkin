# Deploy / Migration Order of Operations

## Why this exists

PR #917's review found a critical, deploy-sequencing bug that no test could have caught: the PR's `DROP TABLE "HouseholdLead"` migration shipped in the **same release** as the backfill it depended on, while `origin/main`'s JWT callback reads `householdLeads` on every authenticated request. Migrations finish *before* the rolling deploy starts, so for the entire multi-minute drain window, old code would have run against a schema it can't read — site-wide 500s, plus any lead change old code wrote between backfill and drop silently destroyed. See [comment on #917](https://github.com/innovationtreehouse/checkin/pull/917#issuecomment-4889400528).

Two more incidents in the same week (#791/#792, below) came from the same root cause in different clothes: nobody had written down what order migrations, code, and deploys actually happen in, so every PR re-derived it from scratch and some got it wrong. This doc is that missing reference. Read it before writing a migration; `.claude/skills/migration-safety/SKILL.md` turns it into a checklist that fires automatically when one's being built.

## The deploy sequence

Both `deploy-dev.yml` and `deploy-prod.yml` run the identical shape (dev triggers on merge to `main`; prod on a published GitHub release — see each file's header comment):

1. Merge/release triggers CI, then the deploy workflow builds and pushes an image.
2. **A one-off ECS task runs `prisma migrate deploy` to completion** — ALL pending migrations, in filename order — before anything else touches the service. ([`deploy-dev.yml:104-178`](../../.github/workflows/deploy-dev.yml#L104-L178), [`deploy-prod.yml:116-190`](../../.github/workflows/deploy-prod.yml#L116-L190)). The database is VPC-only, so this task (and any other one-off DB access) has to run inside ECS on the service's own network config — there's no reaching it from a laptop or a GitHub-hosted runner directly.
   - The shared Aurora Serverless v2 cluster auto-pauses at zero traffic; the first connection after idle races the resume and Prisma throws `P1001`. The migrate task's container command is a 5-attempt retry loop with a 20s backoff for exactly this ([`deploy-dev.yml:136-144`](../../.github/workflows/deploy-dev.yml#L136-L144)). Any new one-off DB task needs the same pattern — `checkin-app/src/lib/auroraResumeRetry.ts` is the equivalent for in-request reads (retries only `P1001`, rethrows everything else).
   - The task's own container logs (`/ecs/checkin-migrate-<env>`) are dumped into the Actions run output ([`deploy-dev.yml:162-173`](../../.github/workflows/deploy-dev.yml#L162-L173)) — added after the 2026-07-02 incident, where a bare "exit code 1" hid the real Prisma error in CloudWatch for a day.
3. **Only after migrations fully succeed** does `aws ecs update-service` start the rolling deploy ([`deploy-dev.yml:180-207`](../../.github/workflows/deploy-dev.yml#L180-L207)).
4. Old tasks keep serving live traffic for a multi-minute drain window while new tasks come up and the old ones deregister.

**The consequence that drives every rule below:** *old code serves live traffic against the fully-migrated schema during every deploy.* A migration is never validated only against the code shipping alongside it — it has to be safe for whatever is running in production the moment before the deploy starts.

## The rules

### 1. Expand first
Additive changes — nullable columns, new tables, backfills, new indexes — may ship in the same release as the code that starts using them. Nothing currently running depends on their absence.

### 2. Cut over every reader and writer — not just the TypeScript ones
Before anything is removed or tightened, grep for every consumer of the old shape, including the surfaces `tsc` can't see:
- Shell scripts with raw SQL (`checkin-app/scripts/*.sh` — PR #917's own cutover sweep missed `full_reset_and_dev_init.sh`'s raw `INSERT INTO "HouseholdLead"`, which would have aborted the dev-reset script mid-run post-drop).
- Audit-log `tableName` string literals (`"HouseholdLead"` at the review's finding #6 — these don't get renamed by a schema change, they're just strings).
- `checkin-app/docs/VOCABULARY.md` and any other doc asserting a model exists.
- Seed files (`prisma/seed.ts`).

### 3. Contract last — in a separate, later release
Destructive changes — `DROP TABLE`/`DROP COLUMN`, `SET NOT NULL` on a column old code can still write null to, a rename of anything old code touches — ship only after the cutover code from rule 2 has fully rolled out. **Never in the same release as the expand stage that feeds it.** This is PR #917's critical finding: backfill + `DROP TABLE` together means old code 500s site-wide for the whole drain window, and writes landing between the backfill and the drop are silently lost.

This isn't a mechanical "always split into two PRs" rule — it's "prove old code can't violate the new constraint." PR #918 (`Household.name` → `NOT NULL`) shipped the backfill and the `SET NOT NULL` in one migration, one release, because every live write path already always wrote a non-null name (verified in the PR description) — there was no old-code path left that could violate it. If you can't make that same case, split the release.

### 4. Hand-write renames — never trust Prisma's generated migration for one
Prisma has no `RENAME` primitive in its diff engine: a column rename generates as `DROP COLUMN` + `ADD COLUMN`; a model rename generates as `DROP TABLE` + `CREATE TABLE`. On an empty database (every CI run, every fresh local setup) this looks fine. On a populated table it's a hard failure (`23502: ... contains null values`) or, worse, silent data loss when the new column happens to be nullable.

This is exactly what happened 2026-07-02: three generated "rename" migrations passed CI and every local run (empty DBs), then wedged dev for over a day when one of them hit a populated table. Fixed in [PR #791](https://github.com/innovationtreehouse/checkin/pull/791) by hand-rewriting them as `ALTER TABLE ... RENAME COLUMN` / `ALTER TABLE ... RENAME TO`, plus `RENAME CONSTRAINT` / `ALTER INDEX ... RENAME` for the objects that ride along with a table. (The rewritten migrations themselves no longer exist as separate files — [PR #792](https://github.com/innovationtreehouse/checkin/pull/792) squashed the whole chain into `20260703130000_squashed_init` the next day — so #791's diff is the exemplar to read, not a file in the current tree.)

### 5. Wrap multi-statement migrations in `BEGIN;` / `COMMIT;`
Prisma does not wrap a migration file in a transaction on Postgres ([prisma/prisma#15295](https://github.com/prisma/prisma/issues/15295)) — a multi-statement migration can **partially apply**. The 2026-07-02 incident hit this directly: one table's `ALTER` committed, the sibling table's rolled back in the same migration file, requiring manual surgical repair before the automated fix (#791) could even be deployed. If a migration touches more than one statement that needs to succeed or fail together, wrap it in explicit `BEGIN;` / `COMMIT;` — a failure becomes a clean atomic retry instead of a wedge.

### 6. A failed migration wedges every future deploy until a human intervenes
A failed migration leaves a row in `_prisma_migrations` with no success recorded. Every subsequent `migrate deploy` — meaning every subsequent deploy of any kind, unrelated PRs included — fails fast with `P3009` ("migrate found failed migrations in the target database") until someone runs:

```
npx prisma migrate resolve --rolled-back <migration_name>   # it did NOT apply — safe default
npx prisma migrate resolve --applied <migration_name>       # ONLY after manually verifying the schema actually matches
```

Run this via the same one-off ECS task pattern used for deploys (register a migrate task-def revision, `run-task` with a command override, since the DB is VPC-only and unreachable from outside it). This is exactly the unblock PR #791 needed after merging.

The same P3009 class shows up after a **squash**: PR #792 replaced 49 migration files with one baseline (`20260703130000_squashed_init`). Any database that had already applied the old chain has to have its ledger reconciled by hand before its next deploy —

```sql
DELETE FROM "_prisma_migrations";
```
```
npx prisma migrate resolve --applied 20260703130000_squashed_init
```

— on **every** already-migrated database (dev, any long-lived local/shared DB), not just prod; a fresh database just runs the new baseline normally. The migration's own header comment carries these instructions for exactly this reason (see the top of that file). A squash-style migration PR legitimately **fails** `migration-safety.yml` (below) for this reason — that's expected, not a signal something's wrong with the PR.

The ledger's checksum (what `migrate resolve`/`migrate deploy` compare against) is a sha256 of the migration's `migration.sql` — editing an already-applied file's contents (as #791 did, on migrations no environment had applied yet) is safe; editing one that's already recorded as applied anywhere is not.

### 7. Misc rules with incident backing
- **Postgres does not auto-index foreign key columns.** `Person.householdId` in PR #917 had no `@@index` anywhere in its migration history — collapsing the `HouseholdLead` join table into a flag on `Person` silently turned an indexed lookup into a full `Person` seq-scan on hot paths (check-in notification fan-out, nav badges). Add `@@index` for any relation scalar you actually query, in the same migration that adds the column.
- **Same-timestamp migrations from two open PRs interleave lexicographically at deploy time.** Prisma applies migrations in filename order; if two schema PRs are both open, check what order their timestamps put them in once both land — a same-timestamp collision (verified harmless for #917/#918's specific case, checked via `git merge-tree`) isn't guaranteed harmless in general.
- **Schema field changes need `/// @sensitivity:<tier>` annotations** (see `docs/security/SECURITY-POLICY.md`) with regenerated `classifications.ts` committed — this is a CI-enforced, CODEOWNERS-gated check, and it's a schema-adjacent step easy to forget in the middle of a migration-focused PR.
- **Aurora Serverless v2 auto-pauses.** Any new one-off DB task (not just the two deploy workflows) needs the retry-loop pattern from rule/step 2 above, or its first connection will race the resume and fail with `P1001`.

## How to verify

- **`migration-safety.yml`** (added in #794, after the 2026-07-02 incident) applies the PR's new migrations on top of a **seeded, populated** database — not the always-empty DB that local dev and CI's own drift check use. It catches "this migration fails/loses data on a populated table" (the class of bug rules 4–5 exist for). It does **not** and cannot catch deploy-*sequencing* hazards — whether the migration is compatible with the code currently running in prod during the drain window (rules 1–3). A green check here is necessary, not sufficient; the #917 critical finding shipped with this check fully green.
- The CI drift check (`ci.yml` → "Check migrations match schema") only proves the migration files reproduce `schema.prisma` on an **empty** DB — it exercises none of the populated-DB or sequencing concerns above.
- What still needs human judgment on every migration PR: is anything destructive, and if so, has the reader/writer cutover it depends on already fully rolled out in a prior release? That's the one check no CI job can perform, because it requires knowing what's actually running in production right now — the [migration-safety skill](../../.claude/skills/migration-safety/SKILL.md) turns the rules above into the checklist to run that judgment against.
