/** A name write that can never blank a Person: a trimmed non-empty string, or undefined
 *  (meaning "leave the stored name alone"). */
export const nameWrite = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

/** A nickname write: a trimmed non-empty string, `null` to clear it, or `undefined`
 *  (meaning "leave the stored nickname alone"). Unlike a name, a nickname is optional,
 *  so an explicit blank clears it rather than being rejected. */
export const nicknameWrite = (v: unknown): string | null | undefined =>
    v === undefined ? undefined : (typeof v === "string" && v.trim() ? v.trim() : null);
