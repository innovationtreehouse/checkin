import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Off-palette color drift guard (UI-AUDIT.md / UI-AUDIT-verdicts.md) — mirrors
 * `lifecycleStatusLiteralAllowlist.test.ts`'s scanner-with-allowlist pattern: a `walk()`
 * that skips `node_modules`/`generated`/`__tests__`, a brace-aware capture of the RHS of
 * every `color` assignment, a hand-maintained ALLOWLIST, and — critically — two
 * assertions: no new unlisted hit, and no stale allowlist entry.
 *
 * Scope (the "off-palette color sweep" PR): decorative/status colors that drifted off the
 * brand palette (green/blue/teal/cyan/grape/orange/pink/indigo). `red`/`yellow` are
 * deliberately OUTSIDE the banned set — repainting the near-universal destructive/warning
 * convention (Deny/Delete buttons, validation Alerts) is an org-level design decision this
 * PR explicitly does not make (97 `red` + 25 `yellow` instances, almost all destructive/
 * error UI). See the PR description for the full rationale.
 *
 * Matches all three shapes the color audit found:
 *   - JSX prop:       `color="grape"`
 *   - object literal: `color: 'grape'`               (e.g. a ROLE_META-shaped status map)
 *   - ternary/expr:    `color={cond ? 'grape' : 'blue'}` (brace-captured, so both branches
 *                       of a nested ternary are visible to the regex even though it's a
 *                       single capture)
 * A new off-palette color anywhere else fails CI, forcing the author to either use a brand
 * token (`treehouseGreen`/`treehousePurple`/`gray`) or register a justified ALLOWLIST entry.
 */

const SRC = join(__dirname, '..');

const BANNED = ['green', 'blue', 'teal', 'cyan', 'grape', 'orange', 'pink', 'indigo'] as const;
const BANNED_RE = new RegExp(`['"](${BANNED.join('|')})['"]`);

/**
 * Every file that keeps a genuine off-palette `color` value on purpose, with a justification.
 * Note: `components/ToolLevelBadge.tsx` (the regulated Shop Safety Rules cert palette) needs
 * NO entry here — like the red/yellow safety alerts, it never uses a `color=`/`color:` prop
 * at all (its dot/bg/fg are raw hex via `styles`), so it's already outside the scanned set;
 * listing it would trip the stale-entry check below.
 */
const ALLOWLIST: Record<string, string> = {
    'components/AppFrame.tsx': 'DEV badge + header border (orange), dev-instance-gated — never shown in prod.',
    'components/admin/SystemHealthPanels.tsx':
        'Latency good/warn/bad status triad (green leg) — mirrors the yellow/red siblings and the SVG threshold colors; repainting only the green leg would desync it from both.',
};

// ── scanner (mirrors lifecycleStatusLiteralAllowlist.test.ts's walk/captureObject) ──────

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

/** Capture the brace-balanced expression starting at/after `from`, skipping strings &
 *  comments so a brace inside them can't unbalance the scan (e.g. a ternary's string
 *  literals, or a nested object). Same mechanics as the lifecycle guard's captureObject. */
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

// `color` followed by `=` (JSX prop) or `:` (object literal / ROLE_META-shaped map).
const COLOR_RE = /\bcolor\s*[:=]\s*/g;

/** Capture the RHS of a `color` assignment: a quoted literal, or (if it opens with `{`) the
 *  brace-balanced expression — which is what makes a ternary's OFF branch visible too. */
function captureColorValue(src: string, afterMatch: number): string | null {
    const c = src[afterMatch];
    if (c === '"' || c === "'" || c === '`') {
        const q = c;
        let j = afterMatch + 1;
        while (j < src.length && src[j] !== q) {
            if (src[j] === '\\') j++;
            j++;
        }
        return src.slice(afterMatch, j + 1);
    }
    if (c === '{') {
        const cap = captureObject(src, afterMatch);
        return cap ? cap.text : null;
    }
    return null;
}

/** Files with a `color` value containing an off-palette literal (any of the three shapes). */
function scan(): Set<string> {
    const hits = new Set<string>();
    for (const file of walk(SRC)) {
        const src = readFileSync(file, 'utf8');
        const rel = relative(SRC, file).split(sep).join('/');
        COLOR_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = COLOR_RE.exec(src))) {
            const rhs = captureColorValue(src, m.index + m[0].length);
            if (rhs && BANNED_RE.test(rhs)) hits.add(rel);
        }
    }
    return hits;
}

describe('off-palette color allowlist drift guard', () => {
    const flagged = scan();
    const known = new Set(Object.keys(ALLOWLIST));

    it('no unlisted off-palette color (green/blue/teal/cyan/grape/orange/pink/indigo)', () => {
        const unexpected = [...flagged].filter((f) => !known.has(f)).sort();
        // A new hit here must be repainted to a brand token (treehouseGreen / treehousePurple /
        // gray) or registered in ALLOWLIST with a justification — see the file header.
        expect(unexpected).toEqual([]);
    });

    it('has no stale allowlist entry (a listed file no longer keeps an off-palette color)', () => {
        const stale = [...known].filter((f) => !flagged.has(f)).sort();
        expect(stale).toEqual([]);
    });
});
