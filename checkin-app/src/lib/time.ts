// ponytail: default/fallback timezone. The editable org timezone lives in AppSettings
// (lib/appSettings.ts) and is honored server-side (event creation, trends). Client-side
// display helpers below still use this constant — wire them to AppSettings via a layout
// provider if/when a second-region deploy needs client display in a non-Central zone.
export const APP_TIMEZONE = 'America/Chicago';

/**
 * Returns a localized date string formatted in the application's central timezone
 */
export function formatDate(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString(undefined, { timeZone: APP_TIMEZONE, ...options });
}

/**
 * Returns a localized time string formatted in the application's central timezone
 */
export function formatTime(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!date) return '';
    return new Date(date).toLocaleTimeString(undefined, { timeZone: APP_TIMEZONE, ...options });
}

/**
 * Returns a combined localized date and time string formatted in the application's central timezone
 */
export function formatDateTime(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!date) return '';
    return new Date(date).toLocaleString(undefined, { timeZone: APP_TIMEZONE, ...options });
}

/**
 * Coarse "how long ago" for freshness lines ("just now", "12 min ago", "3 hr ago",
 * "2 d ago"). No timezone involved — it's a difference, not a wall-clock reading.
 * Deliberately coarse: it answers "is this stale?", not "exactly when?" — pair it
 * with formatDateTime when the precise instant matters.
 */
export function relTime(when: string | Date, now: Date | number = Date.now()): string {
    const ms = new Date(now).getTime() - new Date(when).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    return `${Math.floor(hr / 24)} d ago`;
}

/**
 * Visit time range for display: "1:35 PM-2:19 PM (44 minutes)" once departed,
 * or "1:35 PM-" while still active (no end time, no length — too dynamic).
 * Times are shown without seconds.
 */
export function formatVisitRange(
    arrived: Date | string | number | null | undefined,
    departed?: Date | string | number | null | undefined,
): string {
    if (!arrived) return '';
    const hm: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    const start = formatTime(arrived, hm);
    if (!departed) return `${start}-`;
    const mins = Math.round((new Date(departed).getTime() - new Date(arrived).getTime()) / 60000);
    return `${start}-${formatTime(departed, hm)} (${mins} minute${mins === 1 ? '' : 's'})`;
}

/**
 * Format a date as a value for an <input type="datetime-local"> (yyyy-MM-ddTHH:mm).
 *
 * NOTE: datetime-local is inherently local, so this uses the BROWSER's timezone — matching the
 * inline `getTime() - getTimezoneOffset()*60000` conversions it replaces. It deliberately does
 * NOT use APP_TIMEZONE; switching to that would change the displayed value.
 */
export function toDatetimeLocal(date: Date | string | number | null | undefined): string {
    if (!date) return '';
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

/**
 * Parse an <input type="datetime-local"> value into a UTC ISO string. Inverse of toDatetimeLocal.
 * Returns '' for empty/invalid input.
 */
export function fromDatetimeLocal(value: string | null | undefined): string {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString();
}

/**
 * Format a calendar-date field (program dates, DOB, memberSince — stored at UTC
 * midnight by convention) UTC-pinned, so the stored calendar day renders
 * unshifted in every zone. Counterpart to formatDate, which is for instants.
 * See docs/designs/1149_DATE_TIME_TZ_DESIGN.md.
 */
export function formatDateOnly(date: Date | string | number | null | undefined, options?: Intl.DateTimeFormatOptions): string {
    if (!date) return '';
    return new Date(date).toLocaleDateString(undefined, { timeZone: 'UTC', ...options });
}

/**
 * Parse an <input type="date"> value ("yyyy-MM-dd") into the calendar-date
 * storage convention: UTC midnight (what `new Date` does to a bare date).
 * The single write-side seam if the storage model ever changes (the design
 * doc's open decision). A value already carrying a time parses as-is.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
    return value ? new Date(value) : null;
}

/**
 * Returns the calendar age in whole years for the given DOB, decremented if
 * the birthday hasn't happened yet as of `asOf`. Canonical implementation — use
 * this everywhere instead of inline epoch-diff age math.
 *
 * `asOf` defaults to now (the common case). Program age gates pass the program's
 * start date so the bound is judged as-of when the program begins, not when the
 * person happens to register.
 *
 * Both sides are read via getUTC* because a DOB is a calendar date stored at UTC
 * midnight — local fields off that instant read a day early west of UTC.
 * ponytail: that pins the birthday rollover to UTC midnight (7 PM Chicago) for
 * the default `asOf = now`, so an evening lookup can register a birthday a few
 * hours early. Upgrade path is the org-timezone provider (design Axis 2 /
 * Sequencing step 5), not a local-field read here — mixing the two is the bug.
 */
export function calculateAge(dob: Date | string, asOf: Date | string = new Date()): number {
    const birthDate = new Date(dob);
    const today = new Date(asOf);
    let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const m = today.getUTCMonth() - birthDate.getUTCMonth();
    if (m < 0 || (m === 0 && today.getUTCDate() < birthDate.getUTCDate())) age--;
    return age;
}

/**
 * Returns true if the person with the given DOB is under 18 years old (youth).
 * Canonical implementation — use this everywhere instead of inline age checks.
 *
 * Unknown (null/undefined) DOB resolves to `unknownIs`, default 'adult': UI and
 * household-lead callers rely on that (a null-DOB member stays promotable to
 * lead, blank forms don't show youth fields). Safety checks must pass
 * `{ unknownIs: 'youth' }` so missing data fails closed (#300).
 */
export function isYouth(
    dob: Date | string | null | undefined,
    opts?: { unknownIs?: 'youth' | 'adult' },
): boolean {
    if (!dob) return (opts?.unknownIs ?? 'adult') === 'youth';
    return calculateAge(dob) < 18;
}
