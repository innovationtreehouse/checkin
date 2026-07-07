import { buildIcs, escapeIcsText, toIcsUtc, googleCalendarEventUrl } from "./ics";

const DTSTAMP = new Date("2026-01-02T03:04:05Z");

/** Split a folded document back into logical (unfolded) content lines. */
function contentLines(ics: string): string[] {
    return ics.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
}

describe("escapeIcsText", () => {
    it("escapes backslash, semicolon, comma and newlines (backslash first)", () => {
        expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
        expect(escapeIcsText("line1\nline2\r\nline3\rline4")).toBe("line1\\nline2\\nline3\\nline4");
    });
    it("does not double-escape an already-plain string", () => {
        expect(escapeIcsText("Just a name")).toBe("Just a name");
    });
});

describe("toIcsUtc", () => {
    it("formats as zero-padded UTC DATE-TIME with Z", () => {
        expect(toIcsUtc(new Date("2026-07-06T14:30:09Z"))).toBe("20260706T143009Z");
    });
    it("uses UTC regardless of local wall-clock components", () => {
        // A time with single-digit month/day/hour must pad to two digits.
        expect(toIcsUtc(new Date("2026-03-04T05:06:07Z"))).toBe("20260304T050607Z");
    });
});

describe("buildIcs — structure & line endings", () => {
    const ics = buildIcs(
        [{ uid: "e1@host", start: new Date("2026-07-06T14:00:00Z"), end: new Date("2026-07-06T16:00:00Z"), summary: "Robotics" }],
        { prodId: "-//Test//EN", dtstamp: DTSTAMP },
    );

    it("uses CRLF everywhere and a trailing CRLF", () => {
        expect(ics.endsWith("\r\n")).toBe(true);
        expect(ics.includes("\n")).toBe(true);
        // No bare LF that isn't preceded by CR.
        expect(/[^\r]\n/.test(ics)).toBe(false);
    });

    it("wraps events in a VCALENDAR with the required headers", () => {
        const lines = contentLines(ics);
        expect(lines[0]).toBe("BEGIN:VCALENDAR");
        expect(lines).toContain("VERSION:2.0");
        expect(lines).toContain("PRODID:-//Test//EN");
        expect(lines[lines.length - 1]).toBe("END:VCALENDAR");
    });

    it("emits a well-formed VEVENT with UID/DTSTAMP/DTSTART/DTEND/SUMMARY", () => {
        const lines = contentLines(ics);
        expect(lines).toContain("BEGIN:VEVENT");
        expect(lines).toContain("UID:e1@host");
        expect(lines).toContain("DTSTAMP:20260102T030405Z");
        expect(lines).toContain("DTSTART:20260706T140000Z");
        expect(lines).toContain("DTEND:20260706T160000Z");
        expect(lines).toContain("SUMMARY:Robotics");
        expect(lines).toContain("END:VEVENT");
    });

    it("emits one VEVENT block per event", () => {
        const many = buildIcs(
            [
                { uid: "a", start: DTSTAMP, end: DTSTAMP, summary: "A" },
                { uid: "b", start: DTSTAMP, end: DTSTAMP, summary: "B" },
            ],
            { prodId: "-//Test//EN", dtstamp: DTSTAMP },
        );
        expect(many.match(/BEGIN:VEVENT/g)).toHaveLength(2);
        expect(many.match(/END:VEVENT/g)).toHaveLength(2);
    });
});

describe("buildIcs — field escaping and optional fields", () => {
    it("escapes SUMMARY/DESCRIPTION/LOCATION text", () => {
        const lines = contentLines(
            buildIcs(
                [{
                    uid: "e", start: DTSTAMP, end: DTSTAMP,
                    summary: "Chess, Level 1; Beginners",
                    description: "Bring a board\nand a pen",
                    location: "Room 5, Building A",
                }],
                { prodId: "-//Test//EN", dtstamp: DTSTAMP },
            ),
        );
        expect(lines).toContain("SUMMARY:Chess\\, Level 1\\; Beginners");
        expect(lines).toContain("DESCRIPTION:Bring a board\\nand a pen");
        expect(lines).toContain("LOCATION:Room 5\\, Building A");
    });

    it("omits DESCRIPTION and LOCATION when absent/null", () => {
        const lines = contentLines(
            buildIcs(
                [{ uid: "e", start: DTSTAMP, end: DTSTAMP, summary: "Plain", description: null, location: null }],
                { prodId: "-//Test//EN", dtstamp: DTSTAMP },
            ),
        );
        expect(lines.some((l) => l.startsWith("DESCRIPTION"))).toBe(false);
        expect(lines.some((l) => l.startsWith("LOCATION"))).toBe(false);
    });
});

describe("buildIcs — missing end & all-day", () => {
    it("omits DTEND when end is missing", () => {
        const lines = contentLines(
            buildIcs(
                [{ uid: "e", start: new Date("2026-07-06T14:00:00Z"), summary: "Open-ended" }],
                { prodId: "-//Test//EN", dtstamp: DTSTAMP },
            ),
        );
        expect(lines).toContain("DTSTART:20260706T140000Z");
        expect(lines.some((l) => l.startsWith("DTEND"))).toBe(false);
    });

    it("emits VALUE=DATE for all-day events (start-only and with end)", () => {
        const oneDay = contentLines(
            buildIcs([{ uid: "e", start: new Date("2026-07-06T00:00:00Z"), allDay: true, summary: "All day" }],
                { prodId: "-//Test//EN", dtstamp: DTSTAMP }),
        );
        expect(oneDay).toContain("DTSTART;VALUE=DATE:20260706");
        expect(oneDay.some((l) => l.startsWith("DTEND"))).toBe(false);

        const ranged = contentLines(
            buildIcs([{ uid: "e", start: new Date("2026-07-06T00:00:00Z"), end: new Date("2026-07-08T00:00:00Z"), allDay: true, summary: "Camp" }],
                { prodId: "-//Test//EN", dtstamp: DTSTAMP }),
        );
        expect(ranged).toContain("DTSTART;VALUE=DATE:20260706");
        expect(ranged).toContain("DTEND;VALUE=DATE:20260708");
    });
});

describe("buildIcs — line folding (RFC 5545 §3.1)", () => {
    const longSummary = "X".repeat(200);
    const raw = buildIcs([{ uid: "e", start: DTSTAMP, end: DTSTAMP, summary: longSummary }], { prodId: "-//Test//EN", dtstamp: DTSTAMP });

    it("folds physical lines to <=75 chars", () => {
        for (const physical of raw.split("\r\n")) {
            expect(physical.length).toBeLessThanOrEqual(75);
        }
    });

    it("continuation lines start with a single space and unfold losslessly", () => {
        // Every folded continuation is CRLF + space; unfolding restores the value.
        const lines = contentLines(raw);
        expect(lines).toContain(`SUMMARY:${longSummary}`);
    });
});

describe("googleCalendarEventUrl", () => {
    it("builds a TEMPLATE render link with UTC dates and encoded params", () => {
        const url = googleCalendarEventUrl({
            start: new Date("2026-07-06T14:00:00Z"),
            end: new Date("2026-07-06T16:00:00Z"),
            summary: "Robotics, Session 1",
            description: "Bring a laptop",
            location: "Room 5",
        });
        expect(url.startsWith("https://calendar.google.com/calendar/render?")).toBe(true);
        const q = new URL(url).searchParams;
        expect(q.get("action")).toBe("TEMPLATE");
        expect(q.get("text")).toBe("Robotics, Session 1");
        expect(q.get("dates")).toBe("20260706T140000Z/20260706T160000Z");
        expect(q.get("details")).toBe("Bring a laptop");
        expect(q.get("location")).toBe("Room 5");
    });

    it("falls back to a zero-length event when end is missing", () => {
        const url = googleCalendarEventUrl({ start: new Date("2026-07-06T14:00:00Z"), summary: "Ping" });
        expect(new URL(url).searchParams.get("dates")).toBe("20260706T140000Z/20260706T140000Z");
        expect(new URL(url).searchParams.has("details")).toBe(false);
    });
});
