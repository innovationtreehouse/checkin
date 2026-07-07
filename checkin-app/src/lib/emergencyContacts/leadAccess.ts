/**
 * Time-scoping for a program lead's emergency-contact access.
 * See docs/designs/LEAD_EMERGENCY_CONTACT_ACCESS.md.
 */

// ponytail: a constant, not config. The window is a fixed product decision, not
// an operator knob — it lives in code where it's reviewed, not in BoardSettings.
export const LEAD_EC_ACCESS_BUFFER_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * A lead may reach a program's emergency contacts only while the program is
 * "live": from BUFFER days before startAt through BUFFER days after endAt.
 *
 * Null start OR end ⇒ no window can be computed ⇒ access DENIED (fail closed).
 */
export function isWithinLeadAccessWindow(
    now: Date,
    startAt: Date | null,
    endAt: Date | null,
    bufferDays: number = LEAD_EC_ACCESS_BUFFER_DAYS,
): boolean {
    if (!startAt || !endAt) return false;
    const buffer = bufferDays * DAY_MS;
    const t = now.getTime();
    return t >= startAt.getTime() - buffer && t <= endAt.getTime() + buffer;
}

/** The 403 body explaining why a lead can't see this program's contacts right now. */
export function timeScopingMessage(startAt: Date | null, endAt: Date | null): string {
    if (!startAt || !endAt) {
        return (
            "Emergency contacts aren't available for this program because it has no " +
            "scheduled start and end dates. Ask a board member if you need them."
        );
    }
    const fmt = (d: Date) =>
        d.toLocaleDateString("en-US", { timeZone: "America/Chicago", year: "numeric", month: "short", day: "numeric" });
    return (
        `Emergency contacts for this program are only available from ${LEAD_EC_ACCESS_BUFFER_DAYS} ` +
        `days before it starts until ${LEAD_EC_ACCESS_BUFFER_DAYS} days after it ends ` +
        `(${fmt(startAt)}–${fmt(endAt)}). Outside that window, ask a board member.`
    );
}
