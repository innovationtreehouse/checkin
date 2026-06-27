/**
 * @jest-environment node
 */
import { PDFDocument } from "pdf-lib";

// Mock the S3 SDK so loadAgreementPdf() can be exercised without real AWS.
const sendMock = jest.fn();
jest.mock("@aws-sdk/client-s3", () => {
    class NoSuchKey extends Error {
        constructor() {
            super("NoSuchKey");
            this.name = "NoSuchKey";
        }
    }
    return {
        S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
        GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
        NoSuchKey,
    };
});

import { loadAgreementPdf, AgreementUnavailableError } from "@/lib/membership/contract/agreementDocument";

/** Mimic an AWS SDK v3 service error — matched by `.name` (as in production). */
function noSuchKeyError(): Error {
    const err = new Error("The specified key does not exist.");
    err.name = "NoSuchKey";
    return err;
}

async function samplePdf(): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.addPage([612, 792]);
    doc.addPage([612, 792]); // two pages — fields sit on the last
    return Buffer.from(await doc.save());
}

describe("loadAgreementPdf", () => {
    const prevBucket = process.env.AGREEMENT_PDF_S3_BUCKET;
    afterEach(() => sendMock.mockReset());
    afterAll(() => {
        process.env.AGREEMENT_PDF_S3_BUCKET = prevBucket;
    });

    it("throws AgreementUnavailableError when no bucket is configured", async () => {
        delete process.env.AGREEMENT_PDF_S3_BUCKET;
        await expect(loadAgreementPdf()).rejects.toBeInstanceOf(AgreementUnavailableError);
        expect(sendMock).not.toHaveBeenCalled();
    });

    it("throws AgreementUnavailableError when the object is missing (NoSuchKey)", async () => {
        process.env.AGREEMENT_PDF_S3_BUCKET = "checkin-assets-test";
        sendMock.mockRejectedValueOnce(noSuchKeyError());
        await expect(loadAgreementPdf()).rejects.toBeInstanceOf(AgreementUnavailableError);
    });

    it("re-throws unexpected S3 errors (not swallowed as 'unavailable')", async () => {
        process.env.AGREEMENT_PDF_S3_BUCKET = "checkin-assets-test";
        sendMock.mockRejectedValueOnce(new Error("AccessDenied"));
        await expect(loadAgreementPdf()).rejects.toThrow("AccessDenied");
    });

    it("returns the PDF bytes + last-page geometry when present", async () => {
        process.env.AGREEMENT_PDF_S3_BUCKET = "checkin-assets-test";
        const bytes = await samplePdf();
        sendMock.mockResolvedValueOnce({
            Body: { transformToByteArray: async () => new Uint8Array(bytes) },
        });

        const res = await loadAgreementPdf();
        expect(Buffer.isBuffer(res.pdf)).toBe(true);
        expect(res.lastPageNo).toBe(1);
        expect(res.pageWidth).toBe(612);
        expect(res.pageHeight).toBe(792);
    });
});
