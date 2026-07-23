import { isPartialIndex, findMissingPartialIndexes, splicePartialIndexes, type IndexRow } from "../lib/partial-indexes";

const VISIT_ONE_OPEN: IndexRow = {
    indexname: "Visit_one_open_per_participant",
    indexdef: 'CREATE UNIQUE INDEX "Visit_one_open_per_participant" ON public."Visit" USING btree ("personId") WHERE ("departedAt" IS NULL)',
};
const PLAIN_INDEX: IndexRow = {
    indexname: "Visit_personId_departedAt_idx",
    indexdef: 'CREATE INDEX "Visit_personId_departedAt_idx" ON public."Visit" USING btree ("personId", "departedAt")',
};

describe("isPartialIndex", () => {
    it("is true for an index with a WHERE clause", () => {
        expect(isPartialIndex(VISIT_ONE_OPEN)).toBe(true);
    });

    it("is false for a plain index", () => {
        expect(isPartialIndex(PLAIN_INDEX)).toBe(false);
    });
});

describe("findMissingPartialIndexes", () => {
    it("returns partial indexes present in truth but absent from candidate", () => {
        const missing = findMissingPartialIndexes([VISIT_ONE_OPEN, PLAIN_INDEX], [PLAIN_INDEX]);
        expect(missing).toEqual([VISIT_ONE_OPEN]);
    });

    it("returns nothing when every partial index is present with the same definition", () => {
        const missing = findMissingPartialIndexes([VISIT_ONE_OPEN, PLAIN_INDEX], [VISIT_ONE_OPEN, PLAIN_INDEX]);
        expect(missing).toEqual([]);
    });

    it("ignores non-partial indexes entirely, even if candidate is missing them", () => {
        const missing = findMissingPartialIndexes([VISIT_ONE_OPEN, PLAIN_INDEX], [VISIT_ONE_OPEN]);
        expect(missing).toEqual([]);
    });

    it("throws instead of silently patching when the same-named index has a different definition", () => {
        const drifted: IndexRow = { ...VISIT_ONE_OPEN, indexdef: VISIT_ONE_OPEN.indexdef.replace("IS NULL", "IS NOT NULL") };
        expect(() => findMissingPartialIndexes([VISIT_ONE_OPEN], [drifted])).toThrow(/different definitions/);
    });
});

describe("splicePartialIndexes", () => {
    it("is a no-op when nothing is missing", () => {
        expect(splicePartialIndexes("-- sql", [])).toBe("-- sql");
    });

    it("appends each missing index's indexdef verbatim with a marker comment", () => {
        const result = splicePartialIndexes("CREATE TABLE Foo (id int);", [VISIT_ONE_OPEN]);
        expect(result).toContain(VISIT_ONE_OPEN.indexdef + ";");
        expect(result).toContain("coalesce-migrations: partial unique index restored");
        expect(result.indexOf("CREATE TABLE Foo")).toBeLessThan(result.indexOf(VISIT_ONE_OPEN.indexdef));
    });

    it("appends one block per missing index", () => {
        const result = splicePartialIndexes("-- sql", [VISIT_ONE_OPEN, PLAIN_INDEX]);
        expect(result.split("coalesce-migrations: partial unique index restored").length - 1).toBe(2);
    });
});
