/**
 * Live-refresh signal for the nav todo-count badges. Mutation sites that change a
 * counted state (emergency contact, membership phase, trusted-adult review, program
 * enrollment) call notifyNavRefresh() after a successful write; the nav listens
 * for the event and refetches /api/nav/todo-counts. Mirrors the receipt-app
 * "receipts-mutated" pattern.
 */
export const NAV_COUNTS_EVENT = "nav-counts-mutated";

export function notifyNavRefresh(): void {
    if (typeof window !== "undefined") {
        window.dispatchEvent(new Event(NAV_COUNTS_EVENT));
    }
}
