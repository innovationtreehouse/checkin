import prisma from "@/lib/prisma";
import { isDuesSettledThrough, programCoverageDate } from "@/lib/orgMembership";

/**
 * Canonical prefix of a program's minted member-discount code
 * (`PRG{programId}-XXXXXXXX`, always uppercase). Single home for the format:
 * the minter (mintMemberDiscountCode in lib/shopify.ts) builds codes with it
 * and the entitlement check below matches on it, so the encoder and decoder
 * cannot drift.
 */
export function programMemberCodePrefix(programId: number): string {
    return `PRG${programId}-`;
}

/**
 * Does this order's coupon list carry THIS program's minted member code? Shopify
 * codes are case-insensitive, so the compare upper-cases and trims the order's side.
 * Prefix-matched on the program's OWN id (the trailing hyphen keeps PRG4 out of
 * PRG42). An EMPTY list is never evidence — pre-#1048 mirror rows carry none.
 */
export function usesProgramMemberCode(discountCodes: string[], programId: number): boolean {
    const prefix = programMemberCodePrefix(programId);
    return discountCodes.some((c) => c.trim().toUpperCase().startsWith(prefix));
}

/**
 * Member-code entitlement, judged AT THE MONEY EVENT: true iff the paid order carries
 * this program's minted member code and NO enrollee's household is dues-settled through
 * the program's coverage date. Callers (the orders/paid webhook, and the reconciler's
 * forward pass recovering a missed one) flag DISCOUNT_UNAUTHORIZED and do not activate.
 *
 * Asked once, when the money moves, and never re-derived afterwards — an ordinary
 * deactivation must not retro-flag orders that were honest when they were paid. The
 * PaymentException row is the durable judgement. Inherits isDuesSettledThrough's
 * fail-open when no membership-year boundary is configured.
 *
 * ACCEPTED WINDOW (named, not engineered away): a minted code lives 48h and is not
 * identity-bound, so entitlement can move between mint and checkout. We judge at
 * checkout, so a code minted while entitled but redeemed after the household lapses
 * is flagged at redemption — the intended answer, not a gap to close.
 */
export async function unentitledMemberCodeUse(
    programId: number,
    personIds: number[],
    discountCodes: string[],
): Promise<boolean> {
    if (!usesProgramMemberCode(discountCodes, programId)) return false;
    const program = await prisma.program.findUnique({ where: { id: programId }, select: { startAt: true, endAt: true } });
    const through = programCoverageDate(program ?? { startAt: null, endAt: null });
    // ponytail: per-person loop, not a batched query — one order enrols one household.
    for (const personId of personIds) {
        if (await isDuesSettledThrough(personId, through)) return false;
    }
    return true;
}
