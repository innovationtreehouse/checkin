/**
 * Canonical prefix of a program's minted member-discount code
 * (`PRG{programId}-XXXXXXXX`, always uppercase). Single home for the format:
 * the minter (mintMemberDiscountCode in lib/shopify.ts) builds codes with it
 * and the finance reconciler's detector matches on it, so the encoder and
 * decoder cannot drift — a silent format change would otherwise leave the
 * detector matching nothing.
 */
export function programMemberCodePrefix(programId: number): string {
    return `PRG${programId}-`;
}
