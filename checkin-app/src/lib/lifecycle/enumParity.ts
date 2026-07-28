/**
 * Enum-parity: prove a LOCAL string-literal union stays in lockstep with a Prisma
 * enum, WITHOUT value-importing the generated enum into the client bundle.
 *
 * Two layers:
 *  - compile-time (`Expect`/`Equal`): a type-only check. The entity does
 *      import type { ProgramParticipantStatus } from '@/generated/prisma/client';
 *      type _Parity = Expect<Equal<LocalStatus, ProgramParticipantStatus>>;
 *    `import type` is erased at build → no Prisma in the client bundle. If the
 *    schema enum changes, this line stops compiling.
 *  - runtime (`assertEnumParity`): for a dev/TEST assertion. A TEST may value-
 *    import the Prisma enum (tests aren't the client bundle) and pass it here to
 *    fail loudly on a mismatch. This file itself imports nothing.
 */

/** Exact type equality (both directions), the standard invariant-position trick. */
export type Equal<A, B> =
    (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Compile error unless `T` is exactly `true`. Use: `type _ = Expect<Equal<X, Y>>`. */
export type Expect<T extends true> = T;

/**
 * Runtime parity check for dev/tests. `prismaEnum` is the generated enum object
 * (Prisma emits `{ PENDING: 'PENDING', ACTIVE: 'ACTIVE' }`); its keys must equal
 * the local `statuses`, as a set. Throws with the diff on mismatch.
 *
 * Keep this OUT of client code — call it only from tests or a dev-time guard, and
 * only there value-import the Prisma enum.
 */
export function assertEnumParity(
    statuses: readonly string[],
    prismaEnum: Record<string, string>,
    label = 'enum',
): void {
    const local = new Set(statuses);
    const prisma = new Set(Object.keys(prismaEnum));

    const missingLocally = [...prisma].filter((k) => !local.has(k));
    const extraLocally = [...local].filter((k) => !prisma.has(k));

    if (missingLocally.length > 0 || extraLocally.length > 0) {
        throw new Error(
            `lifecycle enum-parity mismatch for ${label}: ` +
                `missing in local union [${missingLocally.join(', ')}], ` +
                `extra in local union [${extraLocally.join(', ')}]`,
        );
    }
}
