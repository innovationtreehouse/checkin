import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Guards the runner boundary from issue #228: the app runs on Jest, every
 * `packages/*` and `*-function` workspace runs on Vitest, and a Vitest
 * `.test.ts` must never be swept into this Jest run. Jest's `rootDir` is
 * `checkin-app/`, so collection cannot escape it — this test proves the Vitest
 * suites physically live OUTSIDE `rootDir`, so a regression that relocates a
 * workspace under the app (or points Jest's roots up a level) fails here.
 */

const rootDir = resolve(__dirname, '..', '..'); // checkin-app/
const repoRoot = resolve(rootDir, '..');

function testFilesUnder(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'generated') continue;
            const full = join(d, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.test\.tsx?$/.test(entry.name)) out.push(full);
        }
    };
    if (existsSync(dir)) walk(dir);
    return out;
}

function vitestWorkspaceRoots(): string[] {
    const roots: string[] = [];
    const packagesDir = join(repoRoot, 'packages');
    if (existsSync(packagesDir)) {
        for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
            if (entry.isDirectory()) roots.push(join(packagesDir, entry.name));
        }
    }
    for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.endsWith('-function')) roots.push(join(repoRoot, entry.name));
    }
    return roots;
}

const isOutsideRootDir = (file: string) => relative(rootDir, file).startsWith('..' + sep);

describe('runner boundary (app=Jest, packages/functions=Vitest)', () => {
    const workspaceRoots = vitestWorkspaceRoots();

    it('finds the Vitest workspaces (guards this test from silently matching nothing)', () => {
        expect(workspaceRoots.length).toBeGreaterThan(0);
    });

    it('keeps every Vitest workspace test file outside Jest rootDir', () => {
        const leaked = workspaceRoots
            .flatMap(testFilesUnder)
            .filter((f) => !isOutsideRootDir(f));
        expect(leaked).toEqual([]);
    });
});
