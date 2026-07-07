import prisma from "@/lib/prisma";
import type { DbClient } from "@/lib/db-client";

/**
 * Household soft-archive: set a family aside without deleting anything. An
 * archived household (Household.archivedAt non-null) drops out of default board
 * lists, is skipped by crons/fan-outs, and its members are blocked from starting
 * new activity (enroll / scan / membership application). History is untouched;
 * un-archiving clears the stamp and restores everything.
 * See docs/designs/HOUSEHOLD_ARCHIVE.md.
 */

/** Thrown by the shared write guard when a household is archived. Routes map it to 409. */
export class HouseholdArchivedError extends Error {
    constructor(message = "This household is archived. Ask a board member to un-archive it before continuing.") {
        super(message);
        this.name = "HouseholdArchivedError";
    }
}

/**
 * The shared write guard: throw if the household is archived. One indexed PK
 * read, called at each new-activity choke-point (scan, enroll) so a future
 * caller can't forget the check.
 */
export async function assertHouseholdActive(db: DbClient, householdId: number): Promise<void> {
    const household = await db.household.findUnique({
        where: { id: householdId },
        select: { archivedAt: true },
    });
    if (household?.archivedAt) throw new HouseholdArchivedError();
}

/**
 * Archive or un-archive a household. Idempotent (re-archiving / re-restoring is a
 * no-op that writes no audit row). Who/when is captured in the AuditLog row, not
 * a column. Board/sysadmin only — enforced by the calling route.
 */
export async function setHouseholdArchived(householdId: number, archived: boolean, actorId: number) {
    const existing = await prisma.household.findUnique({ where: { id: householdId }, select: { archivedAt: true } });
    if (!existing) throw new Error("Household not found");

    const isArchived = existing.archivedAt !== null;
    if (isArchived === archived) return { archivedAt: existing.archivedAt }; // idempotent no-op

    const newValue = archived ? new Date() : null;
    const [updated] = await prisma.$transaction([
        prisma.household.update({ where: { id: householdId }, data: { archivedAt: newValue } }),
        prisma.auditLog.create({
            data: {
                actorId,
                action: "EDIT",
                tableName: "Household",
                affectedEntityId: householdId,
                oldData: { archivedAt: existing.archivedAt?.toISOString() ?? null },
                newData: { archivedAt: newValue?.toISOString() ?? null },
            },
        }),
    ]);
    return { archivedAt: updated.archivedAt };
}
