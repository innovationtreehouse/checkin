import type { TxClient } from "@/lib/db-client";

/** Thrown by {@link lockProgramAndCheckCapacity} when a program is full. */
export class ProgramCapacityError extends Error {
    constructor(public readonly spotsLeft: number) {
        super("Program has reached maximum capacity.");
        this.name = "ProgramCapacityError";
    }
}

/**
 * Lock the Program row and verify it has room for `seats` more enrollments,
 * run inside a transaction. Mirrors the lead-cap fix in
 * {@link file://./../household/leads.ts}: the bare count-then-create that
 * callers used to do is a TOCTOU race — under Postgres' default Read Committed
 * isolation two concurrent enrollers both count N and both insert, overfilling
 * the program. The `FOR UPDATE` lock serializes enrollers for this program: the
 * second blocks until the first commits, then re-counts and is rejected.
 *
 * No-op when `maxParticipants` is null (uncapped program). Throws
 * {@link ProgramCapacityError} (carrying remaining spots) when full. The lock
 * auto-releases on commit/rollback.
 */
export async function lockProgramAndCheckCapacity(
    tx: TxClient,
    programId: number,
    seats: number,
    maxParticipants: number | null,
): Promise<void> {
    // FOR UPDATE serializes enrollments for this program. The lock — not the
    // count — is what closes the race; Read Committed alone does not.
    await tx.$queryRaw`SELECT id FROM "Program" WHERE id = ${programId} FOR UPDATE`;

    if (maxParticipants === null) return;

    const count = await tx.programParticipant.count({ where: { programId } });
    if (count + seats > maxParticipants) {
        throw new ProgramCapacityError(Math.max(0, maxParticipants - count));
    }
}
