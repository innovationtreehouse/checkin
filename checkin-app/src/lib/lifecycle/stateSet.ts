/**
 * StateSet — a named set of statuses (+ optional presence-flag rule) that emits
 * BOTH a client-safe runtime predicate (`has`) AND a server Prisma `where`
 * fragment from ONE spec, so the two can never drift apart.
 *
 * Client-safety (see lifecycle/README intent): this file value-imports NOTHING.
 * The Prisma `where` type is a caller-supplied generic param (`Where`), so no
 * `@/generated/prisma` value ever reaches the client bundle. The `where` value
 * is a plain object literal — inert data, no Prisma runtime dependency.
 */

export type StateSet<Row, Where> = {
    /** The status literals this set matches. */
    readonly statuses: readonly string[];
    /** Client-safe predicate. Booleans in, no Prisma. */
    has(row: Row): boolean;
    /** Prisma `where` fragment. Plain object literal, typed only via the generic. */
    readonly where: Where;
};

/**
 * A presence-flag rule: field name → required presence.
 *
 * `true`  ⟺ the (nullable) column must be present  → `has`: `row.field === true`,
 *                                                     `where`: `{ field: { not: null } }`
 * `false` ⟺ the column must be absent              → `has`: `row.field === false`,
 *                                                     `where`: `{ field: null }`
 *
 * Callers pass the column's presence as a boolean into `has` (e.g. `!!row.paidAt`),
 * keeping `Date | null` out of the client-safe predicate.
 */
export type FlagRule = Readonly<Record<string, boolean>>;

/**
 * Build a StateSet. Curried so an entity fixes its own Prisma `WhereInput` as the
 * `Where` type arg while the status/flag types still infer from the spec:
 *
 *   defineStateSet<Prisma.ProgramParticipantWhereInput>()({
 *       statuses: ['ACTIVE'],
 *       flags: { paidAt: true },
 *   })
 *
 * `has` and `where` are derived from the same `statuses`/`flags`, so adding a flag
 * updates both sides at once — they cannot diverge.
 */
export function defineStateSet<Where>() {
    return function <S extends string, Flags extends FlagRule = Record<never, boolean>>(spec: {
        statuses: readonly S[];
        flags?: Flags;
    }): StateSet<{ status: string } & Record<keyof Flags, boolean>, Where> {
        const { statuses, flags } = spec;
        const flagEntries = flags ? Object.entries(flags) : [];
        const statusSet = new Set<string>(statuses);

        // `status: string` (not the set's own literal): callers pass a full row
        // typed with the entity's whole status union, not one narrowed to this set.
        const has = (row: { status: string } & Record<keyof Flags, boolean>): boolean => {
            if (!statusSet.has(row.status)) return false;
            for (const [field, required] of flagEntries) {
                if (Boolean((row as Record<string, unknown>)[field]) !== required) return false;
            }
            return true;
        };

        // Plain object literal → no Prisma runtime dependency. Cast once: the shape
        // is built dynamically from `flags`, so TS can't check it against an
        // arbitrary caller `Where`; the caller's type arg is the contract.
        const where = {
            status: { in: statuses },
            ...Object.fromEntries(flagEntries.map(([f, req]) => [f, req ? { not: null } : null])),
        } as Where;

        return { statuses, has, where };
    };
}
