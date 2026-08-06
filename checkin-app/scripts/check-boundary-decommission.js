#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * CLI for the whole-entity decommission certifier (lib/boundary-decommission.js),
 * invoked by .github/workflows/security-boundary-isolation.yml when a boundary
 * PR carries non-companion files:
 *
 *   node checkin-app/scripts/check-boundary-decommission.js \
 *       --base <sha> --boundary <path...> -- [violation...]
 *
 * `--boundary` is the set the workflow's is_boundary matched. It is passed in
 * rather than re-derived so there is one definition of "boundary file"; a second
 * copy here would drift fail-open. Omitting it is a non-certification.
 *
 * Exit 0: the boundary diff is a certified whole-entity decommission and every
 * violation is the drop migration or an implied route-file deletion. Exit 1 with
 * reasons otherwise, and the workflow falls back to its ship-alone error. Runs on
 * bare node.
 */

const { execFileSync } = require('child_process');
const { certifyDecommission } = require('./lib/boundary-decommission');

const git = args => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function gitShow(rev, path) {
    try {
        return git(['show', `${rev}:${path}`]);
    } catch {
        return null;
    }
}

// Values of `--flag a b c`, stopping at the next flag or the `--` separator.
function flagValues(argv, flag, end) {
    const i = argv.indexOf(flag);
    if (i === -1) return null;
    const out = [];
    for (let j = i + 1; j < end; j++) {
        if (argv[j].startsWith('--')) break;
        out.push(argv[j]);
    }
    return out;
}

function main(argv) {
    const sepIdx = argv.indexOf('--');
    const end = sepIdx === -1 ? argv.length : sepIdx;
    const baseIdx = argv.indexOf('--base');
    const boundary = flagValues(argv, '--boundary', end);
    if (baseIdx === -1 || !argv[baseIdx + 1] || boundary == null) {
        console.error('usage: check-boundary-decommission.js --base <sha> --boundary <path...> -- [violation...]');
        return 1;
    }
    const baseSha = argv[baseIdx + 1];
    const violations = sepIdx === -1 ? [] : argv.slice(sepIdx + 1);

    // Same three-dot semantics as the workflow's file list: compare against
    // the merge base, so a stale PR branch isn't blamed for main's changes.
    const mergeBase = git(['merge-base', baseSha, 'HEAD']).trim();
    const changed = git(['diff', '--name-status', `${mergeBase}..HEAD`])
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [status, ...rest] = line.split('\t');
            // R/C rows carry two paths; only the destination is kept. A rename
            // therefore reads as a change to the new name alone — the old name
            // never appears, so it can never be mistaken for a deletion the
            // decommission implies.
            return { status: status[0], path: rest[rest.length - 1] };
        });

    const result = certifyDecommission({
        changed,
        violations,
        boundary,
        readBase: p => gitShow(mergeBase, p),
        readHead: p => gitShow('HEAD', p),
    });

    if (!result.ok) {
        console.error('Not a certifiable whole-entity decommission:');
        for (const r of result.reasons) console.error(`  - ${r}`);
        return 1;
    }
    console.log('Certified whole-entity decommission:');
    for (const m of [...new Set(result.removedModels)]) console.log(`  - model ${m} (dropped from schema in this PR)`);
    for (const e of result.removedEndpoints) console.log(`  - route ${e} (no longer served at head)`);
    return 0;
}

// exitCode, not process.exit(): the latter can truncate buffered stdout when it
// is a pipe, which is how the workflow runs this.
process.exitCode = main(process.argv.slice(2));
