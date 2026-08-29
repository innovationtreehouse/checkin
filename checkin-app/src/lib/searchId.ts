/**
 * The row id a search query names, or null when the query is not a bare id.
 *
 * Every ops search box accepts an id as well as text, because the tables behind
 * them print the id column and operators paste one back in. Bounded to Postgres
 * int4: a larger literal would make Prisma throw on the query instead of simply
 * matching nothing, and would never be a real id anyway.
 */
export function searchId(query: string): number | null {
    const trimmed = query.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const id = Number(trimmed);
    return id <= 2147483647 ? id : null;
}

/**
 * Does a person row match what was typed in a search box — name, email, or a bare
 * id? The client-side twin of the OR the people-search routes build, for the
 * lists that filter in the browser. Omit a field the caller doesn't hold and it
 * simply doesn't match on it.
 */
export function matchesPersonQuery(
    person: { id: number; name?: string | null; email?: string | null },
    query: string,
): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (person.name || '').toLowerCase().includes(q)
        || (person.email || '').toLowerCase().includes(q)
        || person.id === searchId(query);
}
