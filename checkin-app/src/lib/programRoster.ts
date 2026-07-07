/**
 * Pure shaping/aggregation for the program-lead "roster & info" surface
 * (GET /api/my-programs/[id]). No prisma here so the attendance math and CSV
 * escaping are unit-testable without a DB. The route does the (scoped) queries
 * and hands the raw rows in.
 *
 * PII note: this module never sees the finance-confidential ProgramParticipant
 * fields (isPaymentPlanRequested / paymentPlanDeniedAt / inventoryHeldAt). The
 * route selects them out entirely; scholarship demand is surfaced as a COUNT on
 * ProgramStats, never per participant.
 */

export type RosterStatus = "ACTIVE" | "PENDING";

/** Household-lead contact for the "who do I call" view. Multiple leads (cap 2)
 *  are joined with "; " so a single field still answers "who + how". */
export type LeadContact = { name: string; email: string | null; phone: string | null };

export type RosterEntry = {
    personId: number;
    name: string;
    status: RosterStatus;
    contact: LeadContact | null;
    attendanceCount: number; // distinct program events attended
    lastSeenAt: string | null; // ISO, most recent arrival at a program event
};

export type EventTurnout = {
    eventId: number;
    name: string;
    startAt: string; // ISO
    attendanceConfirmedAt: string | null; // ISO
    turnout: number; // distinct people who attended
};

export type ProgramStats = {
    enrolled: number; // ACTIVE participants
    pending: number; // PENDING participants
    capacity: number | null; // Program.maxParticipants (null = uncapped)
    eventCount: number;
    scholarshipRequests: number; // COUNT ONLY — no names (finance-confidential)
};

export type ProgramInfo = {
    program: { id: number; name: string } & ProgramStats;
    roster: RosterEntry[];
    events: EventTurnout[];
};

type RawVisit = { personId: number; associatedEventId: number | null; arrivedAt: Date };

/**
 * Collapse raw event visits into per-person attendance (distinct events + last
 * seen) and per-event turnout (distinct people). Distinct-counting guards against
 * the rare double visit row for one person/event.
 */
export function summarizeVisits(visits: RawVisit[]): {
    eventsByPerson: Map<number, Set<number>>;
    lastSeenByPerson: Map<number, Date>;
    peopleByEvent: Map<number, Set<number>>;
} {
    const eventsByPerson = new Map<number, Set<number>>();
    const lastSeenByPerson = new Map<number, Date>();
    const peopleByEvent = new Map<number, Set<number>>();

    for (const v of visits) {
        if (v.associatedEventId == null) continue;
        let evs = eventsByPerson.get(v.personId);
        if (!evs) eventsByPerson.set(v.personId, (evs = new Set()));
        evs.add(v.associatedEventId);

        let ppl = peopleByEvent.get(v.associatedEventId);
        if (!ppl) peopleByEvent.set(v.associatedEventId, (ppl = new Set()));
        ppl.add(v.personId);

        const prev = lastSeenByPerson.get(v.personId);
        if (!prev || v.arrivedAt > prev) lastSeenByPerson.set(v.personId, v.arrivedAt);
    }
    return { eventsByPerson, lastSeenByPerson, peopleByEvent };
}

/** Join household-lead rows into one contact, or null if the household has no lead. */
export function toLeadContact(leads: { name: string | null; email: string | null; phone: string | null }[]): LeadContact | null {
    if (leads.length === 0) return null;
    const join = (vals: (string | null)[]) => vals.filter((v): v is string => !!v).join("; ") || null;
    return {
        name: join(leads.map((l) => l.name)) ?? "",
        email: join(leads.map((l) => l.email)),
        phone: join(leads.map((l) => l.phone)),
    };
}

/** RFC-4180 CSV cell: quote when the value contains a comma, quote, or newline. */
function csvCell(v: string | number | null): string {
    const s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
    return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function rosterCsv(info: ProgramInfo): string {
    return toCsv(
        ["Name", "Status", "Household Lead", "Email", "Phone", "Events Attended", "Last Seen"],
        info.roster.map((r) => [
            r.name,
            r.status,
            r.contact?.name ?? "",
            r.contact?.email ?? "",
            r.contact?.phone ?? "",
            r.attendanceCount,
            r.lastSeenAt ? r.lastSeenAt.slice(0, 10) : "",
        ]),
    );
}

export function eventsCsv(info: ProgramInfo): string {
    return toCsv(
        ["Session", "Date", "Attendance Confirmed", "Turnout"],
        info.events.map((e) => [e.name, e.startAt.slice(0, 10), e.attendanceConfirmedAt ? "yes" : "no", e.turnout]),
    );
}
