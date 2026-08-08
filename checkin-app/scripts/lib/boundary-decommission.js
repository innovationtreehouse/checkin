'use strict';

/**
 * Whole-entity decommission certifier for the security-boundary isolation
 * check (.github/workflows/security-boundary-isolation.yml).
 *
 * A boundary diff qualifies as a decommission — and may therefore accompany
 * prisma/migrations/** and file deletions in one PR — only when the head file
 * equals the base file with entire top-level entries spliced out, byte for
 * byte, and each removed entry's subject ceases to exist in the same PR
 * (model dropped from schema.prisma; route file/verb deleted). Such a diff
 * cannot add exposure: partial edits inside a surviving entry (e.g. deleting
 * one element of an `all:` match, which WIDENS the grant), additions,
 * reorders, re-tiers, and engine-file changes never qualify.
 *
 * Fails closed: any parse surprise or unmet condition is a non-certification,
 * and the workflow falls back to requiring the boundary change to ship alone.
 * Dependency-free CommonJS — the workflow runs it on bare node, no npm ci.
 */

/** @typedef {{ type: 'other'|'entity', container?: string, name?: string, text: string }} Segment */
/** @typedef {{ segments?: Segment[], error?: string }} Segmentation */
/** @typedef {{ removed?: { container: string, name: string }[], error?: string }} EntityDiff */
/** @typedef {{ status: string, path: string }} ChangedFile */
/** @typedef {(path: string) => string | null} FileReader */

// The two declarative policy files the certifier understands. Every other
// boundary file (engine, stripper, generator, this script) always isolates.
const DECLARATIVE_FILES = {
    bindings: 'checkin-app/src/security/scopeBindings.ts',
    registry: 'checkin-app/src/security/registry.ts',
};

const SCHEMA_FILE = 'checkin-app/prisma/schema.prisma';
const MIGRATIONS_DIR = 'checkin-app/prisma/migrations/';

// ── line utilities ─────────────────────────────────────────────────────────

// Strip single-quoted strings, then a trailing // comment, so braces inside
// either don't skew depth tracking. Handles \' escapes; the declarative files
// use no template or double-quoted strings.
function stripStringsAndComments(line) {
    let out = '';
    let inStr = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
            if (c === '\\') i++;
            else if (c === "'") inStr = false;
        } else if (c === "'") {
            inStr = true;
        } else if (c === '/' && line[i + 1] === '/') {
            break;
        } else {
            out += c;
        }
    }
    return out;
}

function curlyDelta(line) {
    let d = 0;
    for (const c of stripStringsAndComments(line)) {
        if (c === '{') d++;
        else if (c === '}') d--;
    }
    return d;
}

const isCommentOrBlank = line => /^\s*$/.test(line) || /^\s*\/\//.test(line);

// ── segmentation ───────────────────────────────────────────────────────────
//
// A file parses into an ordered list of segments: { type: 'other', text } for
// content that must survive a decommission unchanged, and
// { type: 'entity', container, name, text } for a removable top-level entry.
// Comment/blank lines directly above an entry belong to it (they leave with
// it). Joining every segment text with '\n' reproduces the source exactly —
// the byte-strict comparison in diffSegmentations relies on that invariant.

// scopeBindings.ts containers whose top-level entries name a model.
const BINDINGS_CONTAINERS = [
    {
        name: 'SCOPE_BINDINGS',
        open: /^export const SCOPE_BINDINGS = \{$/,
        close: /^\} as const satisfies ScopeBindings;$/,
        entity: /^ {4}([A-Za-z_$][\w$]*): /,
    },
    {
        name: 'ROW_SCOPE_KEY',
        open: /^export const ROW_SCOPE_KEY: Record<string, string> = \{$/,
        close: /^\};$/,
        entity: /^ {4}([A-Za-z_$][\w$]*): /,
    },
    {
        name: 'OPT_OUT_PENDING_ROUTE',
        open: /^export const OPT_OUT_PENDING_ROUTE = new Set<string>\(\[$/,
        close: /^\]\);$/,
        entity: /^ {4}'([A-Za-z_$][\w$]*)',/,
    },
];

/** @returns {Segmentation} */
function segmentByContainers(source, containers) {
    const lines = source.split('\n');
    const segments = [];
    let otherBuf = [];
    let attachBuf = [];
    let active = null;

    const flushOther = () => {
        if (otherBuf.length) {
            segments.push({ type: 'other', text: otherBuf.join('\n') });
            otherBuf = [];
        }
    };
    const spillAttach = () => {
        otherBuf.push(...attachBuf);
        attachBuf = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!active) {
            otherBuf.push(line);
            active = containers.find(c => c.open.test(line)) ?? null;
            continue;
        }
        if (active.close.test(line)) {
            spillAttach();
            otherBuf.push(line);
            active = null;
            continue;
        }
        if (isCommentOrBlank(line)) {
            attachBuf.push(line);
            continue;
        }
        const m = line.match(active.entity);
        if (!m) return { error: `line ${i + 1} is not a ${active.name} entry: ${line.trim()}` };
        const entityLines = [...attachBuf, line];
        attachBuf = [];
        let depth = curlyDelta(line);
        if (depth < 0) return { error: `unbalanced braces at line ${i + 1}` };
        while (depth > 0) {
            i++;
            if (i >= lines.length) return { error: `unterminated entry '${m[1]}'` };
            entityLines.push(lines[i]);
            depth += curlyDelta(lines[i]);
        }
        flushOther();
        segments.push({ type: 'entity', container: active.name, name: m[1], text: entityLines.join('\n') });
    }
    if (active) return { error: `unterminated container ${active.name}` };
    flushOther();
    return checkRoundTrip(segments, source);
}

// registry.ts: top-level defineRoute({...}); / defineOutbound({...}); calls.
/** @returns {Segmentation} */
function segmentTopLevelCalls(source) {
    const lines = source.split('\n');
    const segments = [];
    let otherBuf = [];
    let attachBuf = [];

    const flushOther = () => {
        if (otherBuf.length) {
            segments.push({ type: 'other', text: otherBuf.join('\n') });
            otherBuf = [];
        }
    };
    const spillAttach = () => {
        otherBuf.push(...attachBuf);
        attachBuf = [];
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = line.match(/^(defineRoute|defineOutbound)\(\{$/);
        if (!m) {
            if (isCommentOrBlank(line)) attachBuf.push(line);
            else {
                spillAttach();
                otherBuf.push(line);
            }
            continue;
        }
        const kind = m[1];
        const entityLines = [...attachBuf, line];
        attachBuf = [];
        let depth = curlyDelta(line);
        while (depth > 0) {
            i++;
            if (i >= lines.length) return { error: `unterminated ${kind} call` };
            entityLines.push(lines[i]);
            depth += curlyDelta(lines[i]);
        }
        const text = entityLines.join('\n');
        const key = text.match(/(?:endpoint|surface):\s*'([^']+)'/);
        if (!key) return { error: `${kind} call with no endpoint/surface string` };
        flushOther();
        segments.push({ type: 'entity', container: kind, name: key[1], text });
    }
    spillAttach();
    flushOther();
    return checkRoundTrip(segments, source);
}

// The self-check behind the byte-strict guarantee: segmentation must
// reproduce the source exactly, or nothing downstream can be trusted.
/** @returns {Segmentation} */
function checkRoundTrip(segments, source) {
    if (segments.map(s => s.text).join('\n') !== source) {
        return { error: 'segmentation does not round-trip the source' };
    }
    return { segments };
}

// ── diff ───────────────────────────────────────────────────────────────────

/**
 * Head must equal base with a subset of entity segments spliced out.
 * @param {Segmentation} baseResult
 * @param {string} headSource
 * @param {(source: string) => Segmentation} segmentHead
 * @returns {EntityDiff}
 */
function diffSegmentations(baseResult, headSource, segmentHead) {
    if (baseResult.error) return { error: `base: ${baseResult.error}` };
    const headResult = segmentHead(headSource);
    if (headResult.error) return { error: `head: ${headResult.error}` };

    const key = s => `${s.container} ${s.name}`;
    const headNames = new Set(headResult.segments.filter(s => s.type === 'entity').map(key));
    const baseNames = new Set(baseResult.segments.filter(s => s.type === 'entity').map(key));
    for (const s of headResult.segments) {
        if (s.type === 'entity' && !baseNames.has(key(s))) {
            return { error: `entry added: ${s.container} '${s.name}'` };
        }
    }

    const removed = [];
    const kept = [];
    for (const s of baseResult.segments) {
        if (s.type === 'entity' && !headNames.has(key(s))) removed.push({ container: s.container, name: s.name });
        else kept.push(s.text);
    }
    if (kept.join('\n') !== headSource) {
        return { error: 'diff is not a pure whole-entry removal (an entry or surrounding content was edited)' };
    }
    if (!removed.length) return { error: 'boundary file changed but no entries were removed' };
    return { removed };
}

// ── subject-existence checks ───────────────────────────────────────────────

const hasModel = (schema, model) => new RegExp(`^model\\s+${model}\\s*\\{`, 'm').test(schema);

function endpointToRouteFile(endpoint) {
    const path = endpoint.split(' ')[1];
    return `checkin-app/src/app${path}/route.ts`;
}

function exportsVerb(source, verb) {
    return new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+${verb}\\b`).test(source);
}

// ── certification ──────────────────────────────────────────────────────────

/**
 * @param {{ changed: ChangedFile[], boundaryChanged: string[], violations: string[], readBase: FileReader, readHead: FileReader }} args
 *   changed: git diff --name-status rows (merge-base...head); boundaryChanged:
 *   the subset the workflow's is_boundary matched (the single source of truth
 *   for what a boundary file is); violations: paths the workflow found to be
 *   neither boundary nor companion.
 * @returns {{ ok: boolean, reasons: string[], removedModels: string[], removedEndpoints: string[] }}
 */
function certifyDecommission({ changed, boundaryChanged, violations, readBase, readHead }) {
    /** @type {string[]} */ const reasons = [];
    /** @type {string[]} */ const removedModels = [];
    /** @type {string[]} */ const removedEndpoints = [];

    const declarative = Object.values(DECLARATIVE_FILES);
    for (const p of boundaryChanged) {
        if (!declarative.includes(p)) {
            reasons.push(`${p}: non-declarative boundary file — direction undecidable, never decommission-eligible`);
        }
    }
    if (reasons.length) return { ok: false, reasons, removedModels, removedEndpoints };

    if (boundaryChanged.includes(DECLARATIVE_FILES.bindings)) {
        const base = readBase(DECLARATIVE_FILES.bindings);
        const head = readHead(DECLARATIVE_FILES.bindings);
        if (base == null || head == null) {
            reasons.push(`${DECLARATIVE_FILES.bindings}: added or deleted outright — not a decommission`);
        } else {
            const d = diffSegmentations(
                segmentByContainers(base, BINDINGS_CONTAINERS),
                head,
                s => segmentByContainers(s, BINDINGS_CONTAINERS),
            );
            if (d.error) reasons.push(`${DECLARATIVE_FILES.bindings}: ${d.error}`);
            else removedModels.push(...d.removed.map(r => r.name));
        }
    }

    if (boundaryChanged.includes(DECLARATIVE_FILES.registry)) {
        const base = readBase(DECLARATIVE_FILES.registry);
        const head = readHead(DECLARATIVE_FILES.registry);
        if (base == null || head == null) {
            reasons.push(`${DECLARATIVE_FILES.registry}: added or deleted outright — not a decommission`);
        } else {
            const d = diffSegmentations(segmentTopLevelCalls(base), head, segmentTopLevelCalls);
            if (d.error) reasons.push(`${DECLARATIVE_FILES.registry}: ${d.error}`);
            else {
                for (const r of d.removed) {
                    if (r.container === 'defineOutbound') {
                        reasons.push(`outbound surface '${r.name}': sender code is not tracked, removal must ship alone`);
                    } else {
                        removedEndpoints.push(r.name);
                    }
                }
            }
        }
    }

    if (!reasons.length && !removedModels.length && !removedEndpoints.length) {
        reasons.push('no whole-entry removals found in the boundary diff');
    }

    // Every removed binding's model must leave the schema in this same PR.
    if (removedModels.length) {
        const baseSchema = readBase(SCHEMA_FILE) ?? '';
        const headSchema = readHead(SCHEMA_FILE) ?? '';
        for (const model of [...new Set(removedModels)]) {
            if (!hasModel(baseSchema, model)) reasons.push(`model ${model}: not found in base schema.prisma`);
            else if (hasModel(headSchema, model)) {
                reasons.push(`model ${model}: binding removed but the model survives in schema.prisma`);
            }
        }
    }

    // Every removed route entry's verb must stop being served in this same PR.
    // The base file must resolve AND export the verb first: absence at head only
    // proves the endpoint died if the derived path pointed at a file that served
    // it. A route group, catch-all, rewrite or `route.tsx` makes readHead return
    // null for a path that was never right, which would certify a live endpoint.
    for (const endpoint of removedEndpoints) {
        const [verb] = endpoint.split(' ');
        const file = endpointToRouteFile(endpoint);
        const base = readBase(file);
        if (base == null || !exportsVerb(base, verb)) {
            reasons.push(`${endpoint}: ${file} does not export ${verb} at base — endpoint-to-file mapping unverified`);
            continue;
        }
        const head = readHead(file);
        if (head != null && exportsVerb(head, verb)) {
            reasons.push(`${endpoint}: registry entry removed but ${file} still exports ${verb}`);
        }
    }

    // The exception admits the drop migration, and deletions the decommission
    // itself implies — the route files of the endpoints whose entries left. Any
    // other deletion ships separately: a file nothing imports can still be a
    // security control, and removing one breaks no build and no test, so "it is
    // a deletion" is not evidence that it belongs to the drop.
    const impliedDeletions = new Set(removedEndpoints.map(endpointToRouteFile));
    const deleted = new Set(changed.filter(c => c.status === 'D').map(c => c.path));
    for (const v of violations) {
        if (v.startsWith(MIGRATIONS_DIR)) continue;
        if (deleted.has(v) && impliedDeletions.has(v)) continue;
        reasons.push(
            deleted.has(v)
                ? `${v}: deleted, but not a route file of a removed registry entry — unrelated deletions must ship separately`
                : `${v}: neither a migration nor a deletion — modified/added app code must ship separately`,
        );
    }

    return { ok: reasons.length === 0, reasons, removedModels, removedEndpoints };
}

module.exports = {
    BINDINGS_CONTAINERS,
    DECLARATIVE_FILES,
    certifyDecommission,
    diffSegmentations,
    segmentByContainers,
    segmentTopLevelCalls,
};
