# Zoho import — single-file, no-internet build

`import-zoho.cjs` is a fully self-contained bundle (Prisma client + pg + the import logic,
~5.4 MB). It runs with **plain `node`** — no `npm install`, no `prisma generate`, no `tsx`,
no internet. Built for an air-gapped CloudShell that can reach the DB but not the npm registry.

## Run (on the target)

Upload two things: `import-zoho.cjs` and a folder with the 3 Zoho JSONs
(`ZohoMemberList.json`, `ZohoMemberFamilies.json`, `ZohoMemberInputs.json`).

```bash
export DATABASE_URL="postgresql://USER:PW@HOST:5432/DBNAME?sslmode=require"

node import-zoho.cjs --actor <participantId> --dir ./zoho            # dry run (no writes)
node import-zoho.cjs --actor <participantId> --dir ./zoho --commit   # apply
```

- `--actor` = an existing `Participant.id` in the target DB (stamped on the audit rows). The
  script verifies it exists before writing.
- `--dir` = folder holding the 3 JSON files.
- Dry run prints the full data-quality report and writes nothing. `--commit` writes inside one
  transaction. Re-running `--commit` is idempotent (matches on email / household+name).
- It fails fast (10s) if `DATABASE_URL` is unset or the DB is unreachable.

## Rebuild (only needed if the source or schema changes — requires internet)

```bash
npm install
npm run gen      # prisma generate -> ./generated
npm run build    # esbuild -> import-zoho.cjs
```

`schema.prisma` is the app schema minus the security generator; it must stay in sync with the
target DB for the 5 tables the import writes: Household, Participant, HouseholdLead, Membership,
AuditLog. The `import.meta.url` define in the build is a harmless shim for the unused `__dirname`
line in Prisma's generated client (the query compiler is inlined as base64, so no engine file is
read at runtime).
