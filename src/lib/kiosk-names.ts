type NamedEntity = {
    id: number;
    name: string | null;
    email: string;
};

/**
 * Parse a full name into first and last name parts.
 * Handles "First Last", "Last, First", and email-prefix fallback.
 */
function parseName(entity: NamedEntity): { first: string; last: string } {
    const raw = entity.name?.trim();
    if (!raw) {
        // Fallback to email prefix
        return { first: entity.email.split("@")[0], last: "" };
    }

    // Handle "Last, First" format
    if (raw.includes(",")) {
        const [lastPart, firstPart] = raw.split(",", 2);
        return {
            first: (firstPart || "").trim(),
            last: (lastPart || "").trim(),
        };
    }

    // Standard "First Last" or single-word name
    const parts = raw.split(/\s+/);
    return {
        first: parts[0],
        last: parts.slice(1).join(" "),
    };
}

/**
 * Build a map of participant ID → privacy-friendly display name.
 *
 * Rules:
 * 1. Show first name only by default.
 * 2. If two people share the same first name (case-insensitive),
 *    append the first initial of the last name (e.g. "Sarah M.").
 * 3. If that still isn't unique, append the first two characters
 *    of the last name (e.g. "Sarah Mo.", "Sarah Ma.").
 */
export function getKioskDisplayNames(entities: NamedEntity[]): Map<number, string> {
    const parsed = entities.map((e) => ({
        id: e.id,
        ...parseName(e),
    }));

    // Group by lowercase first name
    const groups = new Map<string, typeof parsed>();
    for (const p of parsed) {
        const key = p.first.toLowerCase();
        const group = groups.get(key) || [];
        group.push(p);
        groups.set(key, group);
    }

    const result = new Map<number, string>();

    for (const group of groups.values()) {
        if (group.length === 1) {
            // Unique first name — no disambiguation needed
            result.set(group[0].id, group[0].first);
            continue;
        }

        // Multiple people share this first name — try 1-char last initial
        const byOneChar = new Map<string, typeof group>();
        for (const p of group) {
            const initial = p.last ? p.last[0].toUpperCase() : "";
            const key = initial;
            const bucket = byOneChar.get(key) || [];
            bucket.push(p);
            byOneChar.set(key, bucket);
        }

        for (const bucket of byOneChar.values()) {
            if (bucket.length === 1) {
                // 1-char initial is sufficient
                const p = bucket[0];
                const suffix = p.last ? ` ${p.last[0].toUpperCase()}.` : "";
                result.set(p.id, p.first + suffix);
            } else {
                // Still ambiguous — use 2-char prefix of last name
                for (const p of bucket) {
                    const prefix = p.last
                        ? p.last.slice(0, 2).charAt(0).toUpperCase() + p.last.slice(1, 2).toLowerCase()
                        : "";
                    const suffix = prefix ? ` ${prefix}.` : "";
                    result.set(p.id, p.first + suffix);
                }
            }
        }
    }

    return result;
}
