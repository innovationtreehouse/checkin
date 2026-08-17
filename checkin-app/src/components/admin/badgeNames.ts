// Pure badge-label helpers, split out of BadgeDocument so they can be unit-tested without
// pulling in @react-pdf/renderer (ESM, untransformed by jest).

// First name only, adding the minimum last-name prefix needed to disambiguate within this batch.
// Unique first name → first name alone. Collision → shortest prefix (1+ chars) that no other
// same-first-name badge shares; a partial prefix gets a trailing "." (e.g. "John S.", "John Sm.").
// True duplicates (identical full name) fall back to the full last name.
export function computeDisplayNames(badges: { id: number; name: string }[]): Map<number, string> {
    const parse = (full: string) => {
        const parts = (full || '').trim().split(/\s+/);
        return { first: parts[0] || '', last: parts.slice(1).join(' ') };
    };
    const parsed = badges.map(b => ({ id: b.id, ...parse(b.name) }));
    const groups = new Map<string, typeof parsed>();
    for (const p of parsed) {
        const key = p.first.toLowerCase();
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
    }
    const result = new Map<number, string>();
    for (const group of groups.values()) {
        for (const p of group) {
            if (group.length === 1 || !p.last) {
                result.set(p.id, p.first || `User #${p.id}`);
                continue;
            }
            const others = group.filter(o => o !== p);
            let len = 1;
            while (len < p.last.length &&
                others.some(o => o.last.slice(0, len).toLowerCase() === p.last.slice(0, len).toLowerCase())) {
                len++;
            }
            const prefix = p.last.slice(0, len);
            const abbreviated = prefix.length < p.last.length;
            result.set(p.id, `${p.first} ${prefix}${abbreviated ? '.' : ''}`);
        }
    }
    return result;
}
