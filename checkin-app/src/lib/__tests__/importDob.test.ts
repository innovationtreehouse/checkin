import { parseImportDob } from "@/lib/importDob";

describe("parseImportDob", () => {
    // Pins the preview/commit drift: an all-digit DOB is an Excel serial, not a
    // year. "33239" must become 1991-01-01, NOT Jan 1 of year 33239 — otherwise
    // preview classifies the person as a youth while commit imports an adult.
    it("parses an Excel-serial DOB to the same date as the commit path", () => {
        const d = parseImportDob("33239")!;
        expect(d.getUTCFullYear()).toBe(1991);
        expect(d.getUTCMonth()).toBe(0);
        expect(d.getUTCDate()).toBe(1);
    });

    it("parses an ISO date string", () => {
        const d = parseImportDob("1991-01-01")!;
        expect(d.getUTCFullYear()).toBe(1991);
    });

    it("returns undefined for empty/unparseable input", () => {
        expect(parseImportDob("")).toBeUndefined();
        expect(parseImportDob(undefined)).toBeUndefined();
        expect(parseImportDob("not a date")).toBeUndefined();
    });
});
