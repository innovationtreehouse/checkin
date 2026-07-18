import type { PersonRoleKind } from "@/generated/prisma/client";
import { type DbClient, withTx } from "@/lib/db-client";

/**
 * The five session/JWT authority booleans. Source of truth is the `PersonRole`
 * table (see prisma/schema.prisma); these are the derived claim names, unchanged
 * from the pre-table boolean-column era so `withAuth`/`BusinessRole`/`SessionUser`/
 * the ~200 session-claim consumers don't move (expand phase of expand/contract).
 */
export type RoleFlag =
    | "isSysadmin"
    | "isBoardMember"
    | "isKeyholder"
    | "isBackgroundCheckReviewer"
    | "isOperations";

export const ROLE_FLAGS: RoleFlag[] = [
    "isSysadmin",
    "isBoardMember",
    "isKeyholder",
    "isBackgroundCheckReviewer",
    "isOperations",
];

export const FLAG_TO_KIND: Record<RoleFlag, PersonRoleKind> = {
    isSysadmin: "SYSADMIN",
    isBoardMember: "BOARD",
    isKeyholder: "KEYHOLDER",
    isBackgroundCheckReviewer: "BG_REVIEWER",
    isOperations: "OPERATIONS",
};

/**
 * Legacy mirror columns on Person, kept in sync by write-through so the ~15
 * existing `where:{isBoardMember:true}`-style readers stay correct without
 * porting them this PR (contract PR ports them, then drops the columns).
 * OPERATIONS has none — it never shipped a column, so it's table-only.
 */
export const KIND_TO_MIRROR: Partial<Record<PersonRoleKind, RoleFlag>> = {
    SYSADMIN: "isSysadmin",
    BOARD: "isBoardMember",
    KEYHOLDER: "isKeyholder",
    BG_REVIEWER: "isBackgroundCheckReviewer",
};

/** Derive the five session booleans from a person's `PersonRole` rows. */
export function rolesToFlags(rows: { role: PersonRoleKind }[]): Record<RoleFlag, boolean> {
    const held = new Set(rows.map((r) => r.role));
    return {
        isSysadmin: held.has("SYSADMIN"),
        isBoardMember: held.has("BOARD"),
        isKeyholder: held.has("KEYHOLDER"),
        isBackgroundCheckReviewer: held.has("BG_REVIEWER"),
        isOperations: held.has("OPERATIONS"),
    };
}

/**
 * Grant or revoke one role flag: writes the `PersonRole` row (truth + grant
 * metadata) AND mirrors the legacy boolean column (if one exists), in one tx.
 * The single dual-write point — every writer routes through this, so no
 * caller hand-writes both the row and the column.
 *
 * Idempotent: granting an already-held role keeps the original grant metadata
 * (upsert's `update` is a no-op) rather than clobbering grantedAt/grantedById.
 */
export async function applyRoleFlag(
    db: DbClient,
    personId: number,
    flag: RoleFlag,
    on: boolean,
    grantedById?: number,
): Promise<void> {
    const role = FLAG_TO_KIND[flag];
    await withTx(db, async (tx) => {
        if (on) {
            await tx.personRole.upsert({
                where: { personId_role: { personId, role } },
                create: { personId, role, grantedById },
                update: {},
            });
        } else {
            await tx.personRole.deleteMany({ where: { personId, role } });
        }
        const mirror = KIND_TO_MIRROR[role];
        if (mirror) {
            await tx.person.update({ where: { id: personId }, data: { [mirror]: on } });
        }
    });
}
