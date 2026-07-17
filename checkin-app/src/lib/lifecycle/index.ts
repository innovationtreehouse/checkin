/**
 * lib/lifecycle — pure, dependency-free, client-safe primitives for declaring an
 * entity's lifecycle as one definition. DEFINITION/VALIDATION layer only: it
 * emits predicates, Prisma `where` fragments, and static analyses — it never
 * executes transitions. Postgres stays the runtime authority.
 *
 * Client-safe: nothing here value-imports Prisma. Prisma `where` types are
 * caller-supplied generic params; the enum-parity check is type-only at build
 * and value-based only in tests.
 */
export { defineStateSet, type StateSet, type FlagRule } from './stateSet';
export { assertNever, defineValidator, type Invariant } from './classify';
export {
    type Transition,
    isLegalTransition,
    reachability,
    type Reachability,
    bfsStates,
    reachableStatesViolating,
} from './transitions';
export { type Equal, type Expect, assertEnumParity } from './enumParity';
