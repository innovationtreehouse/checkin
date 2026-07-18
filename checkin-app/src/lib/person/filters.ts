import type { Prisma } from "@/generated/prisma/client";

/**
 * A live (non-tombstoned) Person. A merged-away record keeps its rows for audit
 * (mergedIntoId set, never deleted), so every surface that must NOT show or count a
 * tombstone — search, rosters, enrollment counts, RSVP/cert lists, the match audit —
 * filters through this. No grep-based drift guard by design: the daily match audit
 * (lib/finance/matchAudit.ts) is the safety net that surfaces any missed surface.
 */
export const LIVE_PERSON: Prisma.PersonWhereInput = { mergedIntoId: null };
