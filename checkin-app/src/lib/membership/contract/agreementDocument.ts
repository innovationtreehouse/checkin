import { readFile } from "fs/promises";
import path from "path";
import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";

/**
 * Loader for the static membership-agreement PDF that gets uploaded to Zoho Sign.
 * We do NOT generate the PDF — Zoho overlays the signature fields onto this file
 * (Printed Name prefilled). Reads the last-page index + dimensions the way the
 * source-of-truth script used pymupdf, but via pdf-lib (pure JS).
 *
 * TODO(#289): drop in the real agreement at AGREEMENT_PDF_PATH once
 * https://github.com/innovationtreehouse/checkin/issues/289 closes. Until then the
 * file is absent and loadAgreementPdf() throws a clear error (and the DO_NOT_SUBMIT
 * marker blocks merge), so the sign endpoint fails loudly rather than uploading a
 * placeholder.
 */
export const AGREEMENT_PDF_PATH = path.join(
    process.cwd(),
    "src/lib/membership/contract/assets/membership-agreement.pdf",
);

/** Filename shown in Zoho for the uploaded document. */
export const AGREEMENT_FILENAME = "membership-agreement.pdf";

export interface LoadedAgreement {
    pdf: Buffer;
    /** Zero-based last-page index (fields sit on the last page, per the script). */
    lastPageNo: number;
    pageWidth: number;
    pageHeight: number;
}

export class AgreementUnavailableError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AgreementUnavailableError";
    }
}

/** Read the agreement PDF and the geometry needed to place the signature fields. */
export async function loadAgreementPdf(): Promise<LoadedAgreement> {
    let pdf: Buffer;
    try {
        pdf = await readFile(AGREEMENT_PDF_PATH);
    } catch {
        throw new AgreementUnavailableError(
            `Membership agreement PDF not found at ${AGREEMENT_PDF_PATH} (pending issue #289).`,
        );
    }

    const doc = await PDFDocument.load(pdf);
    const lastPageNo = doc.getPageCount() - 1;
    const { width, height } = doc.getPage(lastPageNo).getSize();
    return { pdf, lastPageNo, pageWidth: width, pageHeight: height };
}

/**
 * Stamp a diagonal watermark across every page — used on NON-prod instances so a
 * test signature is unmistakably marked as such, both in the signing ceremony and
 * on the final signed PDF. Server-controlled (driven by CHECKIN_ENV), so the
 * applicant can't remove or edit it. Page geometry is unchanged, so signature
 * field placement still matches loadAgreementPdf()'s dimensions. Never applied in
 * prod, which must produce a clean, binding agreement.
 */
export async function stampWatermark(pdf: Buffer, text: string): Promise<Buffer> {
    const doc = await PDFDocument.load(pdf);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
        const { width, height } = page.getSize();
        page.drawText(text, {
            x: width * 0.1,
            y: height * 0.42,
            size: 26,
            font,
            color: rgb(0.85, 0.1, 0.1),
            opacity: 0.22,
            rotate: degrees(45),
        });
    }
    return Buffer.from(await doc.save());
}
