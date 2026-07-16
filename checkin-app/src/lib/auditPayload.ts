// AuditLog.oldData/newData are Prisma `Json?` columns and are now written as
// raw objects (Prisma serializes them, keeping them queryable). Legacy rows
// written before this change hold a double-encoded JSON *string*. Readers must
// tolerate both: parse strings, pass objects through. No data migration runs,
// so both shapes coexist in the DB indefinitely.
export function normalizeAuditData(v: unknown): unknown {
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v; // un-parseable string: hand back as-is
  }
}
