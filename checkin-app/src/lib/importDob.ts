/**
 * Parse a date-of-birth cell from a bulk-import spreadsheet.
 *
 * Shared by the import COMMIT and PREVIEW endpoints so the admin approves the
 * same date that gets imported. If these two ever parse differently again, the
 * preview classifies a person differently than the commit (e.g. minor vs adult).
 *
 * xlsx may hand us an Excel serial number (days since 1899-12-30) as a digit
 * string when no bookType is provided, so handle that before falling back to
 * the native Date parser.
 */
export function parseImportDob(dobString: string | undefined): Date | undefined {
    if (!dobString) return undefined;

    if (/^\d+(\.\d+)?$/.test(dobString)) {
        // Excel serial number
        const serial = parseFloat(dobString);
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        return new Date(excelEpoch.getTime() + serial * 86400000);
    }

    const d = new Date(dobString);
    return isNaN(d.getTime()) ? undefined : d;
}
