import type { Prisma } from "@/generated/prisma/client";

/**
 * A live (non-tombstoned) Person. A merged-away record keeps its rows for audit
 * (mergedIntoId set, never deleted), so every surface that must NOT show or count a
 * tombstone — search, rosters, enrollment counts, RSVP/cert lists, the match audit —
 * filters through this. Drift guard: src/__tests__/livePersonDriftGuard.test.ts scans
 * every Person-query site in src/app + src/lib and fails CI if a new one reads Person
 * without this filter and isn't an explicitly justified exception (sweep/reconciler,
 * historical record, etc).
 */
export const LIVE_PERSON: Prisma.PersonWhereInput = { mergedIntoId: null };
