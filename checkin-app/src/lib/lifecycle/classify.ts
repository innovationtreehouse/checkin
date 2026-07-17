/**
 * classify / validate harness.
 *
 * `classify(row) → StateName | null` — null ⟺ off-diagram. Expressed as a TOTAL
 * function over the status enum: the entity writes an exhaustive `switch` whose
 * `default` hands the value to `assertNever`, so adding an enum value fails to
 * compile until every branch is handled.
 *
 * `validate(row) → { invariant } | null` — runs a list of named invariant
 * predicates and returns the FIRST violated, or null when clean.
 *
 * Pure, client-safe: no imports.
 */

/**
 * Exhaustiveness guard for a `switch` over a status union. Reaching it at runtime
 * means the union grew but a branch was missed — but the point is compile-time:
 * `case`-coverage that misses a value makes the `default: return assertNever(x)`
 * a type error (`x` is not `never`).
 *
 *   function classify(row: Row): State | null {
 *       switch (row.status) {
 *           case 'PENDING': return row.paidAt ? 'awaiting_review' : 'unpaid';
 *           case 'ACTIVE':  return 'active';
 *           default:        return assertNever(row.status);  // ← fails to compile if a status is added
 *       }
 *   }
 */
export function assertNever(value: never): never {
    throw new Error(`lifecycle: unhandled status ${JSON.stringify(value)}`);
}

/** A named invariant: `holds` returns false when the row violates it. */
export type Invariant<Row> = {
    readonly name: string;
    holds(row: Row): boolean;
};

/**
 * Build an entity `validate(row)`: returns `{ invariant }` for the first failing
 * invariant (in list order), or null if all hold.
 */
export function defineValidator<Row>(invariants: readonly Invariant<Row>[]) {
    return function validate(row: Row): { invariant: string } | null {
        for (const inv of invariants) {
            if (!inv.holds(row)) return { invariant: inv.name };
        }
        return null;
    };
}
