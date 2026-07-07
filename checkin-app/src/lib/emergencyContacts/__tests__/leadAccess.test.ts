import { isWithinLeadAccessWindow, LEAD_EC_ACCESS_BUFFER_DAYS, timeScopingMessage } from "../leadAccess";

const DAY = 86_400_000;
const start = new Date("2026-06-01T00:00:00Z");
const end = new Date("2026-06-30T00:00:00Z");
const at = (d: Date, deltaDays: number) => new Date(d.getTime() + deltaDays * DAY);

describe("isWithinLeadAccessWindow", () => {
    it("is in-window during the program", () => {
        expect(isWithinLeadAccessWindow(at(start, 5), start, end)).toBe(true);
    });

    it("is in-window inside the buffer before start and after end", () => {
        expect(isWithinLeadAccessWindow(at(start, -LEAD_EC_ACCESS_BUFFER_DAYS + 1), start, end)).toBe(true);
        expect(isWithinLeadAccessWindow(at(end, LEAD_EC_ACCESS_BUFFER_DAYS - 1), start, end)).toBe(true);
    });

    it("includes the exact buffer edges", () => {
        expect(isWithinLeadAccessWindow(at(start, -LEAD_EC_ACCESS_BUFFER_DAYS), start, end)).toBe(true);
        expect(isWithinLeadAccessWindow(at(end, LEAD_EC_ACCESS_BUFFER_DAYS), start, end)).toBe(true);
    });

    it("is out-of-window just beyond the buffer on either side", () => {
        expect(isWithinLeadAccessWindow(at(start, -LEAD_EC_ACCESS_BUFFER_DAYS - 1), start, end)).toBe(false);
        expect(isWithinLeadAccessWindow(at(end, LEAD_EC_ACCESS_BUFFER_DAYS + 1), start, end)).toBe(false);
    });

    it("fails closed when either date is null", () => {
        expect(isWithinLeadAccessWindow(at(start, 5), null, end)).toBe(false);
        expect(isWithinLeadAccessWindow(at(start, 5), start, null)).toBe(false);
        expect(isWithinLeadAccessWindow(at(start, 5), null, null)).toBe(false);
    });
});

describe("timeScopingMessage", () => {
    it("explains the null-dates case", () => {
        expect(timeScopingMessage(null, end)).toMatch(/no\s+scheduled start and end dates/i);
    });
    it("names the window and the buffer for a dated program", () => {
        const msg = timeScopingMessage(start, end);
        expect(msg).toContain(String(LEAD_EC_ACCESS_BUFFER_DAYS));
        expect(msg).toMatch(/only available/i);
    });
});
