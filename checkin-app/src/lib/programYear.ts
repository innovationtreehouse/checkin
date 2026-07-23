// Pure, prisma-free helpers for the finance-ops board's "next year" flag, so a
// client component can import them (lib/membership/renewal.nextBoundary pulls in
// prisma and can't cross into the browser bundle). Kept dependency-free and
// unit-tested in __tests__/programYear.test.ts.

/** Next occurrence (>= now) of the membership-year boundary's month/day. */
export function nextBoundary(boundary: Date, now: Date): Date {
    const b = new Date(Date.UTC(now.getUTCFullYear(), boundary.getUTCMonth(), boundary.getUTCDate()));
    if (b.getTime() < now.getTime()) b.setUTCFullYear(b.getUTCFullYear() + 1);
    return b;
}

/**
 * A scholarship/payment-plan request "lands next year" when its program starts
 * on/after the next membership-year cutoff. No cutoff configured, or no program
 * start date → unknown (false). ISO strings in (as they arrive over the wire).
 */
export function landsNextYear(startAt: string | null, cutoff: string | null, now: Date = new Date()): boolean {
    if (!startAt || !cutoff) return false;
    return new Date(startAt).getTime() >= nextBoundary(new Date(cutoff), now).getTime();
}
