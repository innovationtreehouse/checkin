/**
 * Badge-print report helpers. See docs/designs/BADGE_PRINT_TRACKING.md.
 */

/**
 * Half-open calendar-year window `[Jan 1 YYYY, Jan 1 YYYY+1)` as UTC instants.
 * Used for both the print scan and the "visited this year" population filter.
 *
 * ponytail: UTC boundary, not APP_TIMEZONE (US Central). A print in the last few
 * evening hours of Dec 31 Central lands in the next UTC year — acceptable at year
 * granularity for an internal ops report. Upgrade path (membership-year /
 * timezone-aware boundary) is documented in the design doc.
 */
export function calendarYearWindow(year: number): { start: Date; end: Date } {
    return {
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year + 1, 0, 1)),
    };
}

/** True when `year` is a plausible 4-digit calendar year for the report. */
export function isReportableYear(year: number): boolean {
    return Number.isInteger(year) && year >= 2000 && year <= 2100;
}
