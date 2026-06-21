import { SIGN_FIELDS, toZohoFields } from "@/lib/membership/contract/signFields";

describe("signFields", () => {
    it("ports the five fields from the source-of-truth script", () => {
        expect(SIGN_FIELDS.map((f) => f.field_name)).toEqual([
            "Signature",
            "DateSigned",
            "PrintedName",
            "InsuranceCo",
            "PolicyNumber",
        ]);
    });

    it("converts percentage coords to absolute (pct/100 × page size, rounded)", () => {
        const fields = toZohoFields("doc-1", 2, 612, 792);
        const sig = fields.find((f) => f.field_name === "Signature")!;
        // x 2% of 612 = 12.24 → 12 ; y 76% of 792 = 601.92 → 602
        expect(sig.x_coord).toBe(12);
        expect(sig.y_coord).toBe(602);
        expect(sig.abs_width).toBe(Math.round(0.54 * 612));
        expect(sig.abs_height).toBe(Math.round(0.08 * 792));
        expect(sig.document_id).toBe("doc-1");
        expect(sig.page_no).toBe(2);
    });

    it("tags text fields with field_category and leaves sign/date untagged", () => {
        const fields = toZohoFields("d", 0, 600, 800);
        expect(fields.find((f) => f.field_name === "PrintedName")!.field_category).toBe("Textfield");
        expect(fields.find((f) => f.field_name === "Signature")!.field_category).toBeUndefined();
    });

    it("applies prefill as a field default_value only where provided", () => {
        const fields = toZohoFields("d", 0, 600, 800, { PrintedName: "Ada Lovelace" });
        expect(fields.find((f) => f.field_name === "PrintedName")!.default_value).toBe("Ada Lovelace");
        expect(fields.find((f) => f.field_name === "InsuranceCo")!.default_value).toBeUndefined();
    });
});
