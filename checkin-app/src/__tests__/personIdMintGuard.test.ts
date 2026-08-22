import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Person-id mint guard (lib/person/mintId.ts) — the write-path sibling of
 * livePersonDriftGuard.test.ts, whose scanner mechanics (walk/skip dirs,
 * comment-masked brace capture) this lifts wholesale.
 *
 * A person id is printed on a physical badge (the QR payload in
 * facility-ops/print-badges and the human-readable "ID:" on BadgeDocument), and
 * Aurora's storage layer prefetches ~32 sequence values that every auto-pause
 * discards. So production Person creates take their id from the IdCounter row
 * via `mintPersonId(tx)` instead of from the sequence.
 *
 * `@default(autoincrement())` deliberately STAYS on Person.id (dropping it makes
 * `id` required in Prisma's create input and turns all ~460 test-fixture creates
 * into type errors, for the same enforcement this file buys in 100 lines). The
 * cost of keeping it is that a missed site does not fail to compile — it
 * silently mints a huge sequence id and nobody notices. This test is the thing
 * that notices.
 *
 * WHAT COUNTS AS A SITE:
 *   1. `prisma|tx|db . person . create|upsert (` whose `data:` (for upsert, its
 *      `create:`) object does not mention `mintPersonId`. Asserting on the
 *      HELPER NAME rather than on the presence of an `id:` key is the same cost
 *      and also catches `id: someOtherNumber`.
 *   2. `householdMembers: { create` — the one relation through which a Person
 *      could be created nested, bypassing `person.create` entirely. Zero hits
 *      today; the clause costs one regex and closes the only route a future one
 *      could take.
 *
 * BLIND SPOTS, stated honestly:
 *   - It is a text scan. A delegate held in a variable (`const p = tx.person;
 *     p.create(…)`) or any dynamic model access escapes it. No such pattern
 *     exists today.
 *   - It does not see raw SQL. A hand-written `INSERT INTO "Person"` in a
 *     migration or a shell script is invisible. None exist.
 *   - It cannot tell whether the mint and the create are in the SAME
 *     transaction. A site that mints on the root client and creates separately
 *     passes here while silently reintroducing gaps on rollback. Nothing
 *     structural prevents that; code review does. (That is also why
 *     `mintPersonId` takes a `TxClient` — the caller must already hold one.)
 *   - It never touches a DB, so it never proves the counter WORKS — only that
 *     nobody bypassed it. mintId.integration.test.ts is the other half.
 *
 * Two assertions, same as every other guard here: no unlisted violation, and no
 * stale allowlist entry.
 */

const SRC = join(__dirname, '..');

/**
 * Files that deliberately create a Person without minting, with a reviewed
 * reason.
 */
const ALLOWLIST: Record<string, string> = {
    'lib/dev/seed-helpers.ts':
        'The twelve debug personas are `person.upsert`s. An eagerly-minted id in an upsert\'s create branch is BURNED on every re-run where the row already exists, so seeding would put a gap in the counter each time the dev seed runs — the opposite of the point. They are a fixed, run-once set, dev databases print no badges, and the helper\'s GREATEST clause absorbs whatever the sequence does there anyway. The `+ Family` macro in the same file is the unbounded, click-repeatable one and DOES mint (see createFamily) — this entry covers the personas only, and the file is listed whole because the allowlist is keyed by file.',
};

// ── scanner (walk / maskComments / captureObject from livePersonDriftGuard) ───

function walk(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
            if (!['node_modules', 'generated', '__tests__'].includes(e.name)) walk(full, out);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
            out.push(full);
        }
    }
    return out;
}

/** A copy of `src` with comment bodies blanked to spaces — same length, so every
 *  index computed below still lines up. Without it a `person.create` named in
 *  prose reads as a site. */
function maskComments(s: string): string {
    const out = s.split('');
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        const d = s[i + 1];
        if (c === '/' && d === '/') {
            while (i < s.length && s[i] !== '\n') out[i++] = ' ';
        } else if (c === '/' && d === '*') {
            const end = s.indexOf('*/', i + 2);
            const stop = end < 0 ? s.length : end + 2;
            while (i < stop) {
                if (s[i] !== '\n') out[i] = ' ';
                i++;
            }
        } else if (c === "'" || c === '"' || c === '`') {
            i++;
            while (i < s.length && s[i] !== c) {
                if (s[i] === '\\') i++;
                i++;
            }
        }
    }
    return out.join('');
}

/** Capture the object literal at/after `from`, skipping strings & comments so a
 *  brace inside them can't unbalance the scan. */
function captureObject(s: string, from: number): { text: string; end: number } | null {
    let i = s.indexOf('{', from);
    if (i < 0) return null;
    const start = i;
    let depth = 0;
    for (; i < s.length; i++) {
        const c = s[i];
        const d = s[i + 1];
        if (c === '/' && d === '/') {
            i = s.indexOf('\n', i);
            if (i < 0) i = s.length;
            continue;
        }
        if (c === '/' && d === '*') {
            i = s.indexOf('*/', i + 2);
            i = i < 0 ? s.length : i + 1;
            continue;
        }
        if (c === "'" || c === '"' || c === '`') {
            const q = c;
            i++;
            while (i < s.length && s[i] !== q) {
                if (s[i] === '\\') i++;
                i++;
            }
            continue;
        }
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return { text: s.slice(start, i + 1), end: i + 1 };
        }
    }
    return null;
}

const CREATE_RE = /\b(?:prisma|tx|db)\.person\.(create|upsert)\s*\(/g;
// The one nesting through which a Person could be created without person.create.
const NESTED_RE = /\bhouseholdMembers\s*:\s*\{\s*create\b/g;
const MINTED_RE = /mintPersonId/;

function scan(): Set<string> {
    const hits = new Set<string>();
    for (const file of walk(SRC)) {
        const src = maskComments(readFileSync(file, 'utf8'));
        const rel = relative(SRC, file).split(sep).join('/');

        CREATE_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = CREATE_RE.exec(src))) {
            const args = captureObject(src, m.index + m[0].length - 1);
            if (!args) continue;
            // `data:` for a create, `create:` for an upsert — the branch that
            // actually inserts a row is the one that has to carry the mint.
            const key = m[1] === 'upsert' ? /\bcreate\s*:/ : /\bdata\s*:/;
            const at = args.text.search(key);
            const payload = at < 0 ? null : captureObject(args.text, at);
            if (!payload || !MINTED_RE.test(payload.text)) hits.add(rel);
        }

        NESTED_RE.lastIndex = 0;
        if (NESTED_RE.test(src)) hits.add(rel);
    }
    return hits;
}

describe('Person id mint guard', () => {
    const flagged = [...scan()];
    const known = new Set(Object.keys(ALLOWLIST));

    it('every production Person create mints its id from the counter', () => {
        const unexpected = flagged.filter((f) => !known.has(f)).sort();
        // A file listed here creates a Person without `mintPersonId(tx)` in the
        // inserted payload. Either pass `id: await mintPersonId(tx)` (wrapping
        // the pair in `withTx(prisma, …)` if the site has no transaction), or add
        // the file to ALLOWLIST above with a reviewed justification. Letting it
        // fall through to the sequence puts an Aurora-sized gap in the badge
        // numbers, silently.
        expect(unexpected).toEqual([]);
    });

    // The scanner is worthless if its regexes stop matching the codebase's
    // shapes; a run that flags nothing at all would pass the assertion above.
    it('actually finds the sites it scans', () => {
        expect(flagged.length).toBeGreaterThan(0);
    });

    it('has no stale allowlist entry', () => {
        const live = new Set(flagged);
        const stale = [...known].filter((f) => !live.has(f)).sort();
        expect(stale).toEqual([]);
    });
});
