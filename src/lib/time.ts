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
 * Returns true if the person with the given DOB is under 18 years old.
 * Canonical implementation — use this everywhere instead of inline age checks.
 * Accepts an optional referenceDate to prevent recreating new Date() in loops.
 */
export function isMinor(dob: Date | string | null | undefined, referenceDate?: Date): boolean {
    if (!dob) return false;
    const birthDate = new Date(dob);
    const today = referenceDate || new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age < 18;
}
