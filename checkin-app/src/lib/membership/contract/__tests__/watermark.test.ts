/**
 * @jest-environment node
 */
import { PDFDocument } from "pdf-lib";
import { stampWatermark } from "@/lib/membership/contract/agreementDocument";

async function makePdf(pages = 2): Promise<Buffer> {
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
    return Buffer.from(await doc.save());
}

describe("stampWatermark", () => {
    it("returns a valid PDF with the same page count and dimensions", async () => {
        const original = await makePdf(2);
        const stamped = await stampWatermark(original, "DEV TEST — NOT A LEGAL AGREEMENT");

        const doc = await PDFDocument.load(stamped);
        expect(doc.getPageCount()).toBe(2);
        // Geometry is unchanged so signature-field placement still lines up.
        const { width, height } = doc.getPage(1).getSize();
        expect(width).toBe(612);
        expect(height).toBe(792);
    });

    it("modifies the document (watermark content is added)", async () => {
        const original = await makePdf(1);
        const stamped = await stampWatermark(original, "DEV TEST — NOT A LEGAL AGREEMENT");
        expect(stamped.length).toBeGreaterThan(original.length);
    });
});
