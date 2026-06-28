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
 * this year's birthday hasn't happened yet. Canonical implementation — use
 * this everywhere instead of inline epoch-diff age math.
 */
export function calculateAge(dob: Date | string): number {
    const birthDate = new Date(dob);
    const today = new Date();
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
