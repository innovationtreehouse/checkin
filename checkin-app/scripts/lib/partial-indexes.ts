/**
 * Prisma's schema DSL cannot express a partial (`WHERE ...`) unique index —
 * this repo has three, hand-written straight into migration.sql (see
 * `Visit_one_open_per_participant`, `membership_one_inflight_initial`,
 * `membership_one_inflight_renewal`). `prisma migrate diff --from-empty
 * --to-schema=schema.prisma` only knows what's in schema.prisma, so it drops
 * these silently — not "the WHERE clause" specifically, the whole index,
 * because schema.prisma has no `@@unique` for them to reconstruct at all.
 * This module detects that gap against a real (TRUTH) database and splices
 * the missing index back in verbatim.
 */

export interface IndexRow {
    indexname: string;
    indexdef: string;
}

export function isPartialIndex(row: IndexRow): boolean {
    return /\bWHERE\b/i.test(row.indexdef);
}

/**
 * Diffs TRUTH's partial indexes against CANDIDATE's.
 * - Present in both, same `indexdef` -> fine, omitted from the result.
 * - Present in both, DIFFERENT `indexdef` -> a real divergence, not a diff
 *   tool limitation — throws instead of returning, so the caller fails loud
 *   rather than silently patching over an actual schema difference.
 * - Missing from candidate entirely -> returned, for splicing.
 */
export function findMissingPartialIndexes(truthIndexes: IndexRow[], candidateIndexes: IndexRow[]): IndexRow[] {
    const candidateByName = new Map(candidateIndexes.map((r) => [r.indexname, r]));
    const missing: IndexRow[] = [];
    for (const truth of truthIndexes.filter(isPartialIndex)) {
        const candidate = candidateByName.get(truth.indexname);
        if (!candidate) {
            missing.push(truth);
        } else if (candidate.indexdef !== truth.indexdef) {
            throw new Error(
                `Partial index "${truth.indexname}" exists in both databases but with different definitions — ` +
                    `a real schema divergence, not something to auto-splice over.\n` +
                    `  truth:     ${truth.indexdef}\n` +
                    `  candidate: ${candidate.indexdef}`,
            );
        }
    }
    return missing;
}

/**
 * Appends each missing index's TRUTH-DB `indexdef` verbatim (it's already a
 * complete, valid `CREATE [UNIQUE] INDEX ... WHERE ...` statement) to the
 * generated migration SQL, with a marker comment recording provenance.
 */
export function splicePartialIndexes(migrationSql: string, missing: IndexRow[]): string {
    if (missing.length === 0) return migrationSql;
    const blocks = missing.map(
        (idx) =>
            `\n-- coalesce-migrations: partial unique index restored — prisma migrate diff --from-empty\n` +
            `-- has no @@unique/@@index in schema.prisma to reconstruct this from (Prisma's DSL can't\n` +
            `-- express a WHERE clause) and drops it silently. Spliced verbatim from the TRUTH DB's\n` +
            `-- pg_indexes.indexdef for "${idx.indexname}".\n` +
            `${idx.indexdef};\n`,
    );
    return migrationSql.replace(/\s*$/, "\n") + blocks.join("");
}
