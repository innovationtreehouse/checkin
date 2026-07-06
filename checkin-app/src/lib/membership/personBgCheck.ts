import { calculateAge } from "@/lib/time";

/**
 * Per-person background-check verdict for the board compliance dashboard
 * (Phase 1 — warn-only, read-only). Generalizes householdBgIsFresh from
 * "any household lead is fresh" to "this specific person is fresh".
 *
 *   NEEDED      — ≥18 (as of the boundary) and NOT background-checked recently.
 *   FRESH       — check still valid at the boundary; already covered.
 *   MINOR       — under 18 as of the boundary; a minor cannot be checked.
 *   DOB_MISSING — no DOB and not declared 25+; age unknown, so we can neither
 *                 confirm ≥18 nor treat them as cleared. A data-hygiene item,
 *                 NOT a bg-needed item (never auto-check a possible minor).
 */
export type PersonBgVerdict = "NEEDED" | "FRESH" | "MINOR" | "DOB_MISSING";

/**
 * Freshness cutoff: boundary minus recheckMonths. Mirrors monthsBefore() in
 * renewal.ts (UTC month math) so per-person freshness matches householdBgIsFresh.
 */
export function bgFreshThreshold(boundary: Date, recheckMonths: number): Date {
    const d = new Date(boundary);
    d.setUTCMonth(d.getUTCMonth() - recheckMonths);
    return d;
}

/**
 * Classify one program-attached person. `boundary` is the annual membership
 * boundary — age is judged as-of it (inclusive: an 18th birthday landing exactly
 * on the boundary counts as ≥18). `threshold` is bgFreshThreshold(boundary, months).
 */
export function personBgVerdict(
    person: { dateOfBirth: Date | null; isDeclaredAdult: boolean; lastBackgroundCheck: Date | null },
    boundary: Date,
    threshold: Date,
): PersonBgVerdict {
    // Unknown age — cannot confirm ≥18, must not be treated as cleared.
    if (!person.dateOfBirth && !person.isDeclaredAdult) return "DOB_MISSING";

    // isDeclaredAdult = "25+, no DOB recorded" → definitely ≥18.
    const isAdult = person.isDeclaredAdult || calculateAge(person.dateOfBirth!, boundary) >= 18;
    if (!isAdult) return "MINOR";

    if (person.lastBackgroundCheck && person.lastBackgroundCheck >= threshold) return "FRESH";
    return "NEEDED";
}
