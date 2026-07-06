import * as fs from "fs";

/**
 * Compares two `pg_dump --schema-only` outputs for semantic identity —
 * used to prove a coalesced single-migration baseline reproduces the exact
 * schema the full migration chain it replaces produces.
 *
 * Two DBs migrated by different paths never dump byte-identical SQL even when
 * the schema is identical:
 * - pg_dump emits a fresh `\restrict`/`\unrestrict` token and timestamp comment
 *   every run.
 * - Column/enum-value order in a dump reflects the order operations happened
 *   in, not the schema's — a chain of migrations that ADD COLUMN over time
 *   dumps columns in a different order than one CREATE TABLE with every column
 *   already present.
 * - `ALTER TABLE ... RENAME` never renames the table's backing sequence, so a
 *   dump replayed through a rename migration can carry an old table's
 *   `_id_seq` name where a fresh single-baseline dump would not.
 *
 * None of that is a real schema difference, so normalize it away before
 * comparing. What's left after normalization is the actual signal.
 */

const NOISE_PREFIXES = ["--", "SET ", "SELECT pg_catalog.set_config", "\\restrict", "\\unrestrict"];

export function normalizeDump(raw: string): string[] {
    const lines = raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter((l) => !NOISE_PREFIXES.some((p) => l.startsWith(p)));

    return lines
        .map((l) => l.replace(/"[A-Za-z0-9_]+_id_seq"/g, '"_id_seq"'))
        // Trailing list-separator commas are positional, not semantic — once every
        // line is sorted as an independent element, a reordered column/enum-value
        // list must not be told apart from the same list in its original order by
        // whichever line happens to have landed last (commaless).
        .map((l) => l.replace(/,$/, ""))
        .sort();
}

export interface DumpDiff {
    identical: boolean;
    onlyInA: string[];
    onlyInB: string[];
}

export function compareDumps(dumpA: string, dumpB: string): DumpDiff {
    const a = normalizeDump(dumpA);
    const b = normalizeDump(dumpB);
    const setA = new Set(a);
    const setB = new Set(b);
    const onlyInA = a.filter((l) => !setB.has(l));
    const onlyInB = b.filter((l) => !setA.has(l));
    return { identical: onlyInA.length === 0 && onlyInB.length === 0, onlyInA, onlyInB };
}

/**
 * CLI: tsx schema-dump-compare.ts <dumpA.sql> <dumpB.sql>
 * Prints the verdict and exits 0 (identical) or 1 (different) — the shared
 * exit-code contract scripts/compare-schema-dumps.sh and its callers rely on.
 */
if (require.main === module) {
    const [fileA, fileB] = process.argv.slice(2);
    if (!fileA || !fileB) {
        console.error("Usage: schema-dump-compare.ts <dumpA.sql> <dumpB.sql>");
        process.exit(2);
    }
    const diff = compareDumps(fs.readFileSync(fileA, "utf8"), fs.readFileSync(fileB, "utf8"));
    if (diff.identical) {
        console.log(`Schemas are semantically identical (${normalizeDump(fs.readFileSync(fileA, "utf8")).length} normalized statement lines).`);
        process.exit(0);
    }
    console.error("Schemas DIFFER after normalization:");
    console.error(`Only in ${fileA} (${diff.onlyInA.length}):`);
    diff.onlyInA.forEach((l) => console.error(`  < ${l}`));
    console.error(`Only in ${fileB} (${diff.onlyInB.length}):`);
    diff.onlyInB.forEach((l) => console.error(`  > ${l}`));
    process.exit(1);
}
