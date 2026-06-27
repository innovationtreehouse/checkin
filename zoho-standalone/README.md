# Zoho import — standalone

Self-contained copy of the importer with only 4 runtime deps (no Next app),
so `npm install` is fast in CloudShell. Same logic as `checkin-app/scripts/import-zoho.ts`.

```bash
npm install            # tiny — prisma + pg + tsx only
npm run gen            # generates ./generated (Prisma client) from schema.prisma

export DATABASE_URL="postgresql://USER:PW@HOST:5432/DBNAME?sslmode=require"
# data files: ZohoMemberList.json, ZohoMemberFamilies.json, ZohoMemberInputs.json in ./zoho

npx tsx import-zoho.ts --actor <participantId> --dir ./zoho            # dry run
npx tsx import-zoho.ts --actor <participantId> --dir ./zoho --commit   # apply
```

- `schema.prisma` is the app schema minus the security generator — must stay in sync with the
  live DB's schema for the models the script writes (Household, Participant, HouseholdLead,
  Membership, AuditLog).
- `--actor` = an existing `Participant.id` in the target DB (stamped on audit rows).
