/** A name write that can never blank a Person: a trimmed non-empty string, or undefined
 *  (meaning "leave the stored name alone"). */
export const nameWrite = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
