/**
 * Transition-table shape + PURE helpers over it.
 *
 * This is a DEFINITION/VALIDATION layer, never a runtime executor: nothing here
 * "runs" a transition against a real row. The helpers feed doc-artifact
 * generation (diagram, coverage matrix, reachability) and tests. Postgres stays
 * the runtime authority.
 *
 * Pure, client-safe: no imports.
 */

/**
 * One declared transition. `State`/`Event`/`Kind` are LOCAL string-literal unions
 * (verified against the Prisma enum by a type-only parity check — see enumParity).
 */
export type Transition<
    State extends string = string,
    Event extends string = string,
    Kind extends string = string,
> = {
    readonly from: State;
    readonly to: State;
    /** The domain event that drives it (e.g. 'payment.captured'). */
    readonly event: Event;
    /** Who performs it (e.g. 'member', 'board', 'system'). */
    readonly actor: string;
    /** Where the guard lives (e.g. 'updateMany compare-and-set', 'route handler'). */
    readonly guardSite: string;
    /** Optional discriminator for entities whose table splits by kind (e.g. INITIAL vs RENEWAL). */
    readonly kind?: Kind;
    /** Marks a transition kept only for backfilled/legacy rows. */
    readonly legacy?: boolean;
};

/** True if some declared transition matches from→to (optionally within `kind`). */
export function isLegalTransition<S extends string, E extends string, K extends string>(
    transitions: readonly Transition<S, E, K>[],
    from: S,
    to: S,
    kind?: K,
): boolean {
    return transitions.some(
        (t) => t.from === from && t.to === to && (kind === undefined || t.kind === undefined || t.kind === kind),
    );
}

export type Reachability<S extends string> = {
    /** States reachable from any initial state, following edges. */
    readonly reachable: readonly S[];
    /** States with zero outgoing transitions (intended end states or stuck states). */
    readonly terminal: readonly S[];
    /** In `allStates` but not reachable from any initial → dead code / drift. */
    readonly unreachable: readonly S[];
    /** Reachable states with no exit that are NOT designated `accepting` → a lint smell. */
    readonly deadEnds: readonly S[];
};

/**
 * Static reachability analysis over a transition table.
 *
 * @param allStates    every declared state (to compute `unreachable`)
 * @param initials     entry state(s)
 * @param accepting    designated legit terminal states; a reachable terminal NOT in
 *                     here is reported as a dead-end. Omit to treat every reachable
 *                     terminal as a dead-end.
 */
export function reachability<S extends string>(
    transitions: readonly Transition<S>[],
    allStates: readonly S[],
    initials: readonly S[],
    accepting: readonly S[] = [],
): Reachability<S> {
    const reachable = bfsStates(transitions, initials);
    const reachableSet = new Set<S>(reachable);
    const acceptingSet = new Set<S>(accepting);

    const hasOutgoing = new Set<S>(transitions.map((t) => t.from));
    const terminal = allStates.filter((s) => !hasOutgoing.has(s));
    const unreachable = allStates.filter((s) => !reachableSet.has(s));
    const deadEnds = terminal.filter((s) => reachableSet.has(s) && !acceptingSet.has(s));

    return { reachable, terminal, unreachable, deadEnds };
}

/**
 * Exhaustive BFS: enumerate every state reachable from `initials`, in discovery
 * order. Pure graph walk — no rows involved.
 */
export function bfsStates<S extends string>(
    transitions: readonly Transition<S>[],
    initials: readonly S[],
): S[] {
    const adjacency = new Map<S, S[]>();
    for (const t of transitions) {
        (adjacency.get(t.from) ?? adjacency.set(t.from, []).get(t.from)!).push(t.to);
    }

    const seen = new Set<S>();
    const order: S[] = [];
    const queue: S[] = [...initials];
    while (queue.length > 0) {
        const state = queue.shift()!;
        if (seen.has(state)) continue;
        seen.add(state);
        order.push(state);
        for (const next of adjacency.get(state) ?? []) {
            if (!seen.has(next)) queue.push(next);
        }
    }
    return order;
}

/**
 * Assert an invariant holds on EVERY reachable state. Returns the states that
 * violate it (empty ⟺ invariant holds everywhere). For tests/doc-checks, e.g.
 * "every reachable state maps to a diagram node".
 */
export function reachableStatesViolating<S extends string>(
    transitions: readonly Transition<S>[],
    initials: readonly S[],
    invariant: (state: S) => boolean,
): S[] {
    return bfsStates(transitions, initials).filter((s) => !invariant(s));
}
