import { lockProgramAndCheckCapacity, ProgramCapacityError } from "@/lib/program/capacity";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Builds a minimal mock TransactionClient: the FOR UPDATE lock is a no-op and
 * the participant count is fixed. Only the surface lockProgramAndCheckCapacity
 * touches is implemented.
 */
function mockTx(count: number): Prisma.TransactionClient {
    return {
        $queryRaw: jest.fn().mockResolvedValue([{ id: 1 }]),
        programParticipant: { count: jest.fn().mockResolvedValue(count) },
    } as unknown as Prisma.TransactionClient;
}

describe("lockProgramAndCheckCapacity", () => {
    // The only multi-seat caller (public-register) can overflow a program by
    // more than one in a single request; seats=1 tests never hit count+seats>max.
    it("throws ProgramCapacityError when a multi-seat request overflows the cap", async () => {
        // count=0, seats=3, max=2 -> 0+3 > 2 -> reject, 2 spots left.
        expect.assertions(2);
        try {
            await lockProgramAndCheckCapacity(mockTx(0), 1, 3, 2);
        } catch (e) {
            expect(e).toBeInstanceOf(ProgramCapacityError);
            expect((e as ProgramCapacityError).spotsLeft).toBe(2);
        }
    });

    it("returns without throwing when seats fit", async () => {
        await expect(
            lockProgramAndCheckCapacity(mockTx(0), 1, 2, 2),
        ).resolves.toBeUndefined();
    });

    it("is a no-op for an uncapped (null max) program", async () => {
        const tx = mockTx(99);
        await expect(
            lockProgramAndCheckCapacity(tx, 1, 5, null),
        ).resolves.toBeUndefined();
        // Short-circuits before counting.
        expect(tx.programParticipant.count).not.toHaveBeenCalled();
    });
});
