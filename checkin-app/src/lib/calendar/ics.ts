// Hand-rolled iCalendar (RFC 5545) output + the matching Google Calendar
// "template" URL — just enough for a program's event schedule, no dependency.
//
// Pure string builders with NO Node/browser-only APIs, so the Google URL helper
// is safe to import into a client component and the ICS builder into a route.

export type CalendarEvent = {
    /** Globally-unique, STABLE id (RFC 5545 §3.8.4.7 requires one) — reuse the
     *  same UID for the same real event so re-imports update, not duplicate. */
    uid: string;
    start: Date;
    /** Omit → VEVENT carries DTSTART only (RFC-valid: default zero duration for a
     *  DATE-TIME start, one day for an all-day DATE start). */
    end?: Date | null;
    /** DATE value type (no time, no Z) instead of the default DATE-TIME (UTC). */
    allDay?: boolean;
    summary: string;
    description?: string | null;
    location?: string | null;
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** UTC DATE-TIME form: `20260706T140000Z`. */
export function toIcsUtc(d: Date): string {
    return (
        `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
        `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
    );
}

/** UTC DATE form (all-day): `20260706`. */
function toIcsDate(d: Date): string {
    return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
}

/** Escape a TEXT value per RFC 5545 §3.3.11: backslash FIRST, then ; , and any
 *  newline → literal `\n`. (CR/LF collapse to a single `\n`.) */
export function escapeIcsText(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/;/g, "\\;")
        .replace(/,/g, "\\,")
        .replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold one content line to ≤75 chars with CRLF + leading-space continuation
 *  (§3.1). ponytail: folds on CHAR boundaries, not octets — for ASCII (names,
 *  dates, the common case) they're identical; a multibyte description yields a
 *  slightly-under-limit line, which every real parser accepts. Upgrade to
 *  byte-exact folding only if a strict-octet parser ever rejects output. */
function foldLine(line: string): string {
    if (line.length <= 75) return line;
    const parts: string[] = [line.slice(0, 75)];
    let rest = line.slice(75);
    while (rest.length > 74) {
        parts.push(rest.slice(0, 74)); // continuation lines lose 1 char to the leading space
        rest = rest.slice(74);
    }
    parts.push(rest);
    return parts.join("\r\n ");
}

function dtLines(ev: CalendarEvent): string[] {
    if (ev.allDay) {
        const out = [`DTSTART;VALUE=DATE:${toIcsDate(ev.start)}`];
        if (ev.end) out.push(`DTEND;VALUE=DATE:${toIcsDate(ev.end)}`);
        return out;
    }
    const out = [`DTSTART:${toIcsUtc(ev.start)}`];
    if (ev.end) out.push(`DTEND:${toIcsUtc(ev.end)}`);
    return out;
}

/** Build a full VCALENDAR document (CRLF line endings, trailing CRLF). */
export function buildIcs(
    events: CalendarEvent[],
    opts: { prodId: string; dtstamp?: Date },
): string {
    const stamp = toIcsUtc(opts.dtstamp ?? new Date());
    const lines: string[] = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        `PRODID:${escapeIcsText(opts.prodId)}`,
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
    ];
    for (const ev of events) {
        lines.push("BEGIN:VEVENT");
        lines.push(`UID:${escapeIcsText(ev.uid)}`);
        lines.push(`DTSTAMP:${stamp}`);
        lines.push(...dtLines(ev));
        lines.push(`SUMMARY:${escapeIcsText(ev.summary)}`);
        if (ev.description) lines.push(`DESCRIPTION:${escapeIcsText(ev.description)}`);
        if (ev.location) lines.push(`LOCATION:${escapeIcsText(ev.location)}`);
        lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    // Fold each content line, then join with CRLF and terminate the last line too.
    return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Pre-filled Google Calendar event URL (opens the "create event" template).
 *  Client-safe (URLSearchParams only). No end → a zero-length event at `start`. */
export function googleCalendarEventUrl(ev: {
    start: Date;
    end?: Date | null;
    summary: string;
    description?: string | null;
    location?: string | null;
}): string {
    const params = new URLSearchParams({
        action: "TEMPLATE",
        text: ev.summary,
        dates: `${toIcsUtc(ev.start)}/${toIcsUtc(ev.end ?? ev.start)}`,
    });
    if (ev.description) params.set("details", ev.description);
    if (ev.location) params.set("location", ev.location);
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
