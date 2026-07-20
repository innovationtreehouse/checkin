/**
 * The completion date a background-check reviewer attests to, when they backdate a
 * check via the review UI (Person.lastBackgroundCheck is otherwise stamped as of
 * clearance time). One source of truth for the date's grammar, shared by the API
 * route (parsing/validation) and the review service (equality between the two
 * reviewers' attestations). Pure — unit-tested without a DB.
 *
 * The attestation is a CALENDAR DAY, never a time: the UI supplies a bare
 * "YYYY-MM-DD" and it is stored at UTC midnight, and two attestations agree iff
 * they name the same UTC day (or both are null = "as of today").
 */

/** UTC "YYYY-MM-DD" for a stored date, or null for "as of today". */
export function attestedDay(d: Date | null | undefined): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
}

/** Two attestations agree iff both are null or name the same UTC day. */
export function sameAttestedDay(a: Date | null | undefined, b: Date | null | undefined): boolean {
    return attestedDay(a) === attestedDay(b);
}

/**
 * Parse the optional backdated completion date from the review UI's native date
 * input into a UTC-midnight Date. Returns { date: null } when absent (the default,
 * "as of today"), { error } for a malformed or future date (a check cannot have
 * been completed in the future), else { date }.
 */
export function parseCheckDate(raw: unknown, now: Date = new Date()): { date: Date | null } | { error: string } {
    if (raw === undefined || raw === null || raw === "") return { date: null };
    if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: "checkDate must be a YYYY-MM-DD date" };
    const date = new Date(`${raw}T00:00:00.000Z`);
    // Number.isNaN alone is not enough: V8 SILENTLY rolls impossible days over
    // (Feb 30 → Mar 2), so a well-formed-but-invalid date would be accepted and
    // shifted. Round-trip the parsed day back to the input to reject those.
    if (Number.isNaN(date.getTime()) || attestedDay(date) !== raw) return { error: "checkDate is not a valid date" };
    if (raw > now.toISOString().slice(0, 10)) return { error: "The check date cannot be in the future" };
    return { date };
}
