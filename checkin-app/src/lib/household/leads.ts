import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Maximum number of leads a single household may have (issue #269).
 * This is policy, not schema shape — change it here, not in a migration.
 */
export const MAX_HOUSEHOLD_LEADS = 2;

/** Thrown by {@link addHouseholdLead} when the per-household lead cap is reached. */
export class HouseholdLeadLimitError extends Error {
    constructor(public readonly householdId: number) {
        super(`A household can have at most ${MAX_HOUSEHOLD_LEADS} leads.`);
        this.name = "HouseholdLeadLimitError";
    }
}

// Accepts either the prisma singleton or a $transaction client. The singleton
// has `$transaction`; a transaction client does not (it's in the ITX deny list),
// which is how we tell them apart at runtime.
type TxClient = Prisma.TransactionClient;
type DbClient = PrismaClient | TxClient;

function isRootClient(db: DbClient): db is PrismaClient {
    return "$transaction" in db;
}

/**
 * The count-then-create core, run inside a transaction. Takes a row lock on the
 * household first so concurrent promotions are serialized: a second caller
 * blocks on the lock, then sees the updated count and is rejected — closing the
 * check-then-act (TOCTOU) race that a bare count+create would leave open.
 */
async function addHouseholdLeadTx(
    tx: TxClient,
    householdId: number,
    participantId: number,
): Promise<{ created: boolean }> {
    // FOR UPDATE serializes lead additions for this household. Postgres' default
    // Read Committed isolation does NOT prevent two transactions from both
    // counting N and both inserting — the explicit lock is what does.
    await tx.$queryRaw`SELECT id FROM "Household" WHERE id = ${householdId} FOR UPDATE`;

    const existing = await tx.householdLead.findUnique({
        where: { householdId_participantId: { householdId, participantId } },
    });
    if (existing) return { created: false };

    const count = await tx.householdLead.count({ where: { householdId } });
    if (count >= MAX_HOUSEHOLD_LEADS) {
        throw new HouseholdLeadLimitError(householdId);
    }

    await tx.householdLead.create({ data: { householdId, participantId } });
    return { created: true };
}

/**
 * Add a household lead, enforcing the per-household cap (issue #269) atomically.
 *
 * Idempotent: if the participant is already a lead of the household this is a
 * no-op and does NOT count against the cap. Throws {@link HouseholdLeadLimitError}
 * when the household already has {@link MAX_HOUSEHOLD_LEADS} distinct leads.
 *
 * Pass the prisma singleton and the call runs in its own atomic transaction;
 * pass a transaction client (inside an existing `$transaction`) and the lock +
 * count + create join that transaction instead. Either way the cap check and the
 * insert are serialized against concurrent promotions for the same household.
 *
 * Does not write an audit log — callers own that, since the actor varies (and is
 * absent for system flows like sign-up).
 *
 * @returns `{ created: true }` if a lead row was inserted, `{ created: false }`
 *          if the participant was already a lead.
 */
export async function addHouseholdLead(
    db: DbClient,
    householdId: number,
    participantId: number,
): Promise<{ created: boolean }> {
    if (isRootClient(db)) {
        return db.$transaction((tx) => addHouseholdLeadTx(tx, householdId, participantId));
    }
    // Already inside a transaction — the caller owns atomicity; just join it.
    return addHouseholdLeadTx(db, householdId, participantId);
}
