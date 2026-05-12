#!/usr/bin/env ts-node
/**
 * CI lint — verifies the security policy layer can't be routed around.
 *
 * Checks (advisory in Sprint 1; flipped to blocking in Sprint 4):
 *   1. Every src/app/api/<x>/route.ts file exports HTTP verbs registered in src/security/registry.ts.
 *   2. Every registry entry corresponds to an existing route file.
 *   3. Migrated routes (listed in scripts/migrated-routes.txt) must NOT call NextResponse.json / Response.json directly.
 *   4. Calls to third-party hosts (shopify.com, myshopify.com, resend.com, SHOPIFY_STORE_DOMAIN) live only in src/lib/shopify.ts and src/lib/email.ts.
 *   5. src/security/generated/classifications.ts is up to date with prisma/schema.prisma.
 *   6. (Advisory always.) Every `dangerously_allow_all_data_access: true` in
 *      the registry is reported by endpoint so each one stays under perpetual
 *      review — the field-level stripper is bypassed and only `authorize`
 *      gates access.
 *
 * Uses string/regex parsing — fast, no AST library to load. Trade-off: a
 * sufficiently-obfuscated bypass slips past, but this lint is one layer
 * among three (CODEOWNERS + contract tests + lint).
 *
 * Run with: npm run check-route-coverage
 * Exit code in default (advisory) mode: 0 even on errors (warnings printed).
 * Pass --strict to fail the build on any error.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(REPO_ROOT, 'src/app/api');
const SRC_DIR = path.join(REPO_ROOT, 'src');
const ADVISORY_MODE = !process.argv.includes('--strict');

const ALLOWED_DIRECT_JSON_FILES = new Set<string>([
    path.join(REPO_ROOT, 'src/lib/api-response.ts'),
    path.join(REPO_ROOT, 'src/security/handler.ts'),
]);

const ALLOWED_THIRD_PARTY_FETCH_FILES = new Set<string>([
    path.join(REPO_ROOT, 'src/lib/shopify.ts'),
    path.join(REPO_ROOT, 'src/lib/email.ts'),
]);

const THIRD_PARTY_HOST_RE = /(shopify\.com|myshopify\.com|resend\.com|SHOPIFY_STORE_DOMAIN)/;
const VERB_EXPORT_RE = /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g;
const JSON_CALL_RE = /\b(NextResponse|Response)\.json\s*\(/;

interface Finding {
    severity: 'error' | 'warn';
    rule: string;
    file: string;
    line?: number;
    message: string;
}
const findings: Finding[] = [];
function report(severity: Finding['severity'], rule: string, file: string, message: string, line?: number) {
    findings.push({ severity, rule, file, line, message });
}

function loadMigratedRoutes(): Set<string> {
    const file = path.join(REPO_ROOT, 'scripts/migrated-routes.txt');
    if (!fs.existsSync(file)) return new Set();
    return new Set(
        fs.readFileSync(file, 'utf-8')
            .split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('#')),
    );
}

function findRouteFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) findRouteFiles(full, out);
        else if (entry.name === 'route.ts' || entry.name === 'route.tsx') out.push(full);
    }
    return out;
}

function fileToEndpointPath(file: string): string {
    const rel = path.relative(API_DIR, path.dirname(file));
    return '/api' + (rel ? '/' + rel : '');
}

function extractExportedVerbs(content: string): string[] {
    const found = new Set<string>();
    let m: RegExpExecArray | null;
    VERB_EXPORT_RE.lastIndex = 0;
    while ((m = VERB_EXPORT_RE.exec(content)) !== null) found.add(m[1]);
    return Array.from(found);
}

function loadRegisteredEndpoints(): { routes: Set<string>; outbounds: Set<string> } {
    // Parse the registry file directly rather than evaluating it — keeps this
    // lint independent of module-resolution quirks. The registry follows a
    // strict shape: defineRoute({ endpoint: '...' }) / defineOutbound({ surface: '...' }).
    const registryPath = path.join(REPO_ROOT, 'src/security/registry.ts');
    const routes = new Set<string>();
    const outbounds = new Set<string>();
    if (!fs.existsSync(registryPath)) {
        report('error', 'registry-load', registryPath, 'registry.ts not found');
        return { routes, outbounds };
    }
    const content = fs.readFileSync(registryPath, 'utf-8');
    const routeRe = /defineRoute\s*\(\s*\{\s*endpoint\s*:\s*['"]([^'"]+)['"]/g;
    const outboundRe = /defineOutbound\s*\(\s*\{\s*surface\s*:\s*['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(content)) !== null) routes.add(m[1]);
    while ((m = outboundRe.exec(content)) !== null) outbounds.add(m[1]);

    // Surface every dangerously_allow_all_data_access use as an advisory
    // warning so each one stays visible in CI output until the maintainer
    // explicitly silences it via audit. Split the file at defineRoute /
    // defineOutbound boundaries so we can attribute the flag to the right
    // endpoint.
    const boundaryRe = /\b(?:defineRoute|defineOutbound)\s*\(/g;
    const positions: number[] = [];
    while ((m = boundaryRe.exec(content)) !== null) positions.push(m.index);
    for (let i = 0; i < positions.length; i++) {
        const start = positions[i];
        const end = positions[i + 1] ?? content.length;
        const block = content.slice(start, end);
        if (!/dangerously_allow_all_data_access\s*:\s*true/.test(block)) continue;
        const endpointMatch = /endpoint\s*:\s*['"]([^'"]+)['"]/.exec(block);
        const label = endpointMatch ? endpointMatch[1] : '(unknown route)';
        report(
            'warn',
            'dangerously-allow-all',
            registryPath,
            `${label} bypasses the field-level stripper (dangerously_allow_all_data_access: true) — review still required`,
        );
    }

    return { routes, outbounds };
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkTsFiles(full, out);
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
    }
    return out;
}

function checkGeneratedFileFresh() {
    try {
        execSync('git diff --exit-code src/security/generated/classifications.ts', {
            cwd: REPO_ROOT,
            stdio: 'pipe',
        });
    } catch {
        report('error', 'stale-generated', 'src/security/generated/classifications.ts',
            'generated file is dirty — run `npx prisma generate` and commit');
    }
}

function main() {
    const migrated = loadMigratedRoutes();
    const { routes: registered } = loadRegisteredEndpoints();
    const routeFiles = findRouteFiles(API_DIR);

    const allRouteEndpoints = new Set<string>();
    for (const file of routeFiles) {
        const endpointPath = fileToEndpointPath(file);
        const content = fs.readFileSync(file, 'utf-8');
        const verbs = extractExportedVerbs(content);

        const migratedVerbs: string[] = [];
        for (const verb of verbs) {
            const key = `${verb} ${endpointPath}`;
            allRouteEndpoints.add(key);
            if (migrated.has(key)) migratedVerbs.push(verb);
            if (migrated.has(key) && !registered.has(key)) {
                report('error', 'missing-registry', file, `migrated route ${key} not in registry`);
            }
        }

        const fullyMigrated = verbs.length > 0 && verbs.every(v => migrated.has(`${v} ${endpointPath}`));
        if (fullyMigrated && !ALLOWED_DIRECT_JSON_FILES.has(file)) {
            const lines = content.split('\n');
            lines.forEach((line, i) => {
                if (JSON_CALL_RE.test(line) && !line.trim().startsWith('//')) {
                    report('error', 'direct-json', file,
                        `migrated route uses ${RegExp.$1}.json() — return ModelBag from handler() body instead`,
                        i + 1);
                }
            });
        }

        if (verbs.length > 0 && migratedVerbs.length === 0) {
            report('warn', 'unmigrated', file,
                `route ${verbs.join('/')} ${endpointPath} has not yet been migrated to handler()`);
        } else if (verbs.length > migratedVerbs.length) {
            const unmigrated = verbs.filter(v => !migrated.has(`${v} ${endpointPath}`));
            report('warn', 'partially-migrated', file,
                `verbs ${unmigrated.join(',')} of ${endpointPath} not yet migrated`);
        }
    }

    for (const key of registered) {
        if (!allRouteEndpoints.has(key)) {
            report('error', 'orphan-registry', 'src/security/registry.ts',
                `registry entry ${key} has no corresponding route file`);
        }
    }

    const allTs = walkTsFiles(SRC_DIR);
    for (const file of allTs) {
        if (ALLOWED_THIRD_PARTY_FETCH_FILES.has(file)) continue;
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        lines.forEach((line, i) => {
            if (THIRD_PARTY_HOST_RE.test(line) && /\bfetch\b/.test(line)) {
                report('error', 'third-party-fetch', file,
                    `direct fetch to third-party host outside gateway — use outboundCall() instead`,
                    i + 1);
            }
        });
    }

    checkGeneratedFileFresh();

    const errors = findings.filter(f => f.severity === 'error');
    const warnings = findings.filter(f => f.severity === 'warn');

    for (const f of findings) {
        const loc = f.line ? `${f.file}:${f.line}` : f.file;
        const tag = f.severity === 'error' ? '✗' : '⚠';
        console.log(`${tag} [${f.rule}] ${loc} — ${f.message}`);
    }
    console.log('');
    console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);

    if (errors.length > 0) {
        if (ADVISORY_MODE) {
            console.log('(advisory mode — exiting 0; pass --strict to fail the build)');
            process.exit(0);
        }
        process.exit(1);
    }
    process.exit(0);
}

main();
