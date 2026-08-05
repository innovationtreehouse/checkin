import type { Prisma } from "@/generated/prisma/client";

/**
 * A live (non-tombstoned) Visit. A deleted visit keeps its row (deletedAt +
 * deletedById set) so the deletion is reviewable and reversible — so every
 * surface that lists, counts, or aggregates visits must filter through this,
 * exactly like LIVE_PERSON (lib/person/filters.ts) for merged-away people.
 * Drift guard: src/__tests__/liveVisitDriftGuard.test.ts scans every
 * Visit-query site in src/app + src/lib and fails CI if a new one reads Visit
 * without this filter and isn't an explicitly justified exception.
 */
export const LIVE_VISIT: Prisma.VisitWhereInput = { deletedAt: null };
