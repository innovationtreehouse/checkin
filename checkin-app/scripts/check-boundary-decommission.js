#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

/**
 * CLI for the whole-entity decommission certifier (lib/boundary-decommission.js),
 * invoked by .github/workflows/security-boundary-isolation.yml when a boundary
 * PR carries non-companion files:
 *
 *   node checkin-app/scripts/check-boundary-decommission.js --base <sha> -- [violation...]
 *
 * Exit 0: the boundary diff is a certified whole-entity decommission and every
 * violation is a migration or a deletion. Exit 1 with reasons otherwise, and
 * the workflow falls back to its ship-alone error. Runs on bare node.
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

function main(argv) {
    const baseIdx = argv.indexOf('--base');
    const sepIdx = argv.indexOf('--');
    if (baseIdx === -1 || !argv[baseIdx + 1]) {
        console.error('usage: check-boundary-decommission.js --base <sha> -- [violation...]');
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
            // R/C rows carry two paths; a rename of a boundary file is an edit
            // of both names, so surface each for the path checks.
            return { status: status[0], path: rest[rest.length - 1] };
        });

    const result = certifyDecommission({
        changed,
        violations,
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

process.exit(main(process.argv.slice(2)));
