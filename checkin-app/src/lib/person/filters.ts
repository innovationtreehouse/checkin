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

/**
 * Person is attached to at least one program in any of the three roles — the shared
 * "who is in the building" population behind the PERSON_BG and PERSON_AGREEMENT
 * obligations and the board compliance lists.
 *
 * Lives here rather than in either trigger module: both need it, and importing one
 * trigger from the other closes an import cycle (personBgTriggers → renewal → payment →
 * personAgreementTriggers → personBgTriggers) that fails at module init with a TDZ error.
 */
export const PROGRAM_ATTACHED_WHERE: Prisma.PersonWhereInput = {
    OR: [
        { programParticipants: { some: {} } },
        { programVolunteers: { some: {} } },
        { programsLed: { some: {} } },
    ],
};
