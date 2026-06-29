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
 * Returns the calendar age in whole years for the given DOB, decremented if
 * the birthday hasn't happened yet as of `asOf`. Canonical implementation — use
 * this everywhere instead of inline epoch-diff age math.
 *
 * `asOf` defaults to now (the common case). Program age gates pass the program's
 * start date so the bound is judged as-of when the program begins, not when the
 * person happens to register.
 */
export function calculateAge(dob: Date | string, asOf: Date | string = new Date()): number {
    const birthDate = new Date(dob);
    const today = new Date(asOf);
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age;
}

/**
 * Returns true if the person with the given DOB is under 18 years old.
 * Canonical implementation — use this everywhere instead of inline age checks.
 */
export function isMinor(dob: Date | string | null | undefined): boolean {
    if (!dob) return false;
    return calculateAge(dob) < 18;
}
