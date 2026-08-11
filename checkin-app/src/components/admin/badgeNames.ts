// Pure badge-label helpers, split out of BadgeDocument so they can be unit-tested without
// pulling in @react-pdf/renderer (ESM, untransformed by jest).

// "2026-2027" style membership year.
// ponytail: year rolls over in June; make configurable if the org changes its membership year.
export function membershipYearLabel(now: Date): string {
    const y = now.getFullYear();
    const startYear = now.getMonth() >= 5 ? y : y - 1;
    return `${startYear}-${startYear + 1}`;
}

type NamedPerson = { id: number; name: string };

// First name only, adding the minimum last-name prefix needed to disambiguate within `cohort`.
// Unique first name → first name alone. Collision → shortest prefix (1+ chars) that no other
// same-first-name person shares; a partial prefix gets a trailing "." (e.g. "John S.", "John Sm.").
// True duplicates (identical full name) fall back to the full last name.
//
// `cohort` is the population a name has to be unique against — the active membership, not the
// batch being printed. A person's badge must read the same whether they are printed alone or
// alongside the whole roster, so each subject is resolved against the cohort (minus itself) and
// never against its fellow subjects.
export function computeDisplayNames(
    subjects: NamedPerson[],
    cohort: NamedPerson[] = subjects,
): Map<number, string> {
    const parse = (full: string) => {
        const parts = (full || '').trim().split(/\s+/);
        return { first: parts[0] || '', last: parts.slice(1).join(' ') };
    };
    const groups = new Map<string, { id: number; last: string }[]>();
    for (const c of cohort) {
        const { first, last } = parse(c.name);
        const key = first.toLowerCase();
        (groups.get(key) ?? groups.set(key, []).get(key)!).push({ id: c.id, last });
    }
    const result = new Map<number, string>();
    for (const s of subjects) {
        const { first, last } = parse(s.name);
        const others = (groups.get(first.toLowerCase()) ?? []).filter(o => o.id !== s.id);
        if (others.length === 0 || !last) {
            result.set(s.id, first || `User #${s.id}`);
            continue;
        }
        let len = 1;
        while (len < last.length &&
            others.some(o => o.last.slice(0, len).toLowerCase() === last.slice(0, len).toLowerCase())) {
            len++;
        }
        const prefix = last.slice(0, len);
        const abbreviated = prefix.length < last.length;
        result.set(s.id, `${first} ${prefix}${abbreviated ? '.' : ''}`);
    }
    return result;
}
