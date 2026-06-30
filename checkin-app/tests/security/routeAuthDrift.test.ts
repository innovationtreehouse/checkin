/**
 * Route auth drift-guard (Step 7 of docs/security/auth-consistency-analysis.md).
 *
 * Static text scan over EVERY `src/app/api/**​/route.ts`. It does NOT touch a DB
 * or run any route — it reads files from disk and asserts how each route ENTERS
 * the auth layer. This is the COMPLEMENT to the validator gate
 * (policy.contract.integration.test.ts + scopeValidators.test.ts): that gate
 * enforces field-stripping + grant-resolvability over REGISTERED routes; this
 * guard enforces that a route can only enter through a sanctioned front door in
 * the first place, so the "new route reaches for getServerSession / forgot to
 * wrap" class can't re-grow (it already re-grew 2→6 once; #580 cut it back).
 *
 * Two rules, both with an explicit, comment-justified allowlist as the ONLY
 * escape hatch:
 *   1. No raw `getServerSession` / `authOptions` in a route file. Use
 *      withAuth/handler (mandatory session), getOptionalSessionUser /
 *      authenticateRequest (optional/public session, lib/auth.ts), or
 *      withCron/withWebhook/withKiosk (non-session).
 *   2. A route that touches `prisma` must enter through one of those wrappers
 *      (or a public-read via getOptionalSessionUser/authenticateRequest). A bare
 *      `export async function GET/POST(...)` that hits prisma with no wrapper =
 *      drift.
 */
import * as fs from 'fs';
import * as path from 'path';

const API_DIR = path.resolve(__dirname, '../../src/app/api');

/**
 * The ONLY sanctioned exceptions. Adding to this Set is a visible, reviewed act
 * — every entry must point at an in-file justification. Paths are relative to
 * src/app/api.
 */
const ALLOWLIST = new Set<string>([
    // Raw getServerSession + authOptions. The dev persona-switch is not a normal
    // authenticated read: on local it must serve anonymous callers (the
    // logged-out picker IS the initial login path) and on cloud-dev it gates on
    // ANY session including a denied one. withAuth (mandatory session) can't
    // express that. Justified in-file at the GET handler ("DRIFT-GUARD ALLOWLIST").
    'auth/dev-personas/route.ts',
    // The NextAuth wiring route itself — it constructs NextAuth(authOptions) and
    // re-exports authOptions for back-compat. This is where authOptions LIVES at
    // the route layer; it imports no prisma and runs no handler of our own.
    'auth/[...nextauth]/route.ts',
    // Deliberately-anonymous PUBLIC WRITE (program self-registration form). It
    // cannot use withAuth (would 401 the public) and is not a read, so
    // getOptionalSessionUser doesn't apply. Abuse is bounded by IP + email rate
    // limits inside the handler (see the "email-bomb / DB-spam target" comment).
    'programs/[id]/public-register/route.ts',
]);

const HTTP_METHODS = 'GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS';
const WRAPPERS = 'withAuth|handler|withCron|withWebhook|withKiosk';
const PUBLIC_SESSION_HELPERS = /\b(getOptionalSessionUser|authenticateRequest)\s*\(/;

/** Strip block + line comments so commented-out mentions (e.g. "a raw
 * getServerSession would...") don't trip the scan. Preserves `://` in URLs. */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Rule 1: returns the offending token, or null. Detects real imports/usage of
 * getServerSession or authOptions (comments already stripped). */
function findRawSessionUse(code: string): string | null {
    if (/\bgetServerSession\b/.test(code)) return 'getServerSession';
    if (/\bauthOptions\b/.test(code)) return 'authOptions';
    return null;
}

/** True if the file imports a prisma client (the @/lib/prisma singleton or a
 * generated client). */
function usesPrisma(code: string): boolean {
    return /from\s+['"]@\/lib\/prisma['"]/.test(code) || /@\/generated\/prisma/.test(code);
}

/** Rule 2: returns a list of unwrapped exported handlers in a prisma route, or
 * []. File-level heuristic: if the file uses getOptionalSessionUser /
 * authenticateRequest anywhere, its bare handlers count as sanctioned
 * public-reads (good enough — a file mixing a public read with an unguarded
 * write is rare and would still trip the validator gate). */
function findUnwrappedPrismaHandlers(code: string): string[] {
    if (!usesPrisma(code)) return [];
    const publicReadOk = PUBLIC_SESSION_HELPERS.test(code);
    const violations: string[] = [];

    // `export const GET = withAuth<...>(...)` — RHS must be a sanctioned wrapper
    // call (optional generic args allowed).
    const constRe = new RegExp(
        `export\\s+const\\s+(${HTTP_METHODS})\\s*=\\s*([A-Za-z_]\\w*)`,
        'g',
    );
    for (const m of code.matchAll(constRe)) {
        if (!new RegExp(`^(${WRAPPERS})$`).test(m[2])) {
            violations.push(`export const ${m[1]} = ${m[2]}(...) — not a sanctioned wrapper`);
        }
    }

    // `export async function GET(...)` — a bare handler is only OK if the file is
    // a sanctioned public-read.
    const fnRe = new RegExp(`export\\s+async\\s+function\\s+(${HTTP_METHODS})\\b`, 'g');
    for (const m of code.matchAll(fnRe)) {
        if (!publicReadOk) {
            violations.push(`export async function ${m[1]}(...) — bare handler, no wrapper`);
        }
    }
    return violations;
}

function walkRouteFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walkRouteFiles(full));
        else if (entry.name === 'route.ts') out.push(full);
    }
    return out;
}

const routeFiles = walkRouteFiles(API_DIR).map((f) => ({
    rel: path.relative(API_DIR, f),
    code: stripComments(fs.readFileSync(f, 'utf8')),
}));

const FIX_1 =
    'Use withAuth/handler (mandatory session), getOptionalSessionUser/authenticateRequest ' +
    '(optional/public session, lib/auth.ts), or withCron/withWebhook/withKiosk (non-session). ' +
    'If genuinely unavoidable, add the file to the ALLOWLIST in this test with a justification.';

describe('route auth drift-guard — every app/api/**/route.ts', () => {
    it('has route files to scan (guard is not vacuous)', () => {
        expect(routeFiles.length).toBeGreaterThan(50);
    });

    describe('rule 1 — no raw getServerSession/authOptions outside the allowlist', () => {
        for (const { rel, code } of routeFiles) {
            if (ALLOWLIST.has(rel)) continue;
            const offender = findRawSessionUse(code);
            it(rel, () => {
                // The asserted value carries the actionable message (jest has no
                // expect-message arg), so a failure prints file + token + fix.
                expect(offender ? `${rel} imports/uses \`${offender}\`. ${FIX_1}` : null).toBeNull();
            });
        }
    });

    describe('rule 2 — every prisma route enters through a sanctioned wrapper', () => {
        for (const { rel, code } of routeFiles) {
            if (ALLOWLIST.has(rel)) continue;
            const violations = findUnwrappedPrismaHandlers(code);
            const msg = violations.length
                ? `${rel} touches prisma but: ${violations.join('; ')}. ` +
                  `Each exported handler must be wrapped in ${WRAPPERS}, or be a ` +
                  `public-read via getOptionalSessionUser/authenticateRequest, or be allowlisted.`
                : null;
            it(rel, () => {
                expect(msg).toBeNull();
            });
        }
    });
});

// The guard must BITE, not just pass vacuously. These assert the detectors on
// synthetic route strings so a future refactor that neuters them is caught.
describe('route auth drift-guard — detectors catch violations', () => {
    it('flags a getServerSession import', () => {
        const synthetic = `import { getServerSession } from "next-auth/next";\nexport const GET = handler('x', async () => {});`;
        expect(findRawSessionUse(stripComments(synthetic))).toBe('getServerSession');
    });

    it('flags an authOptions import', () => {
        expect(findRawSessionUse(stripComments(`import { authOptions } from "@/lib/auth-options";`))).toBe('authOptions');
    });

    it('does NOT flag getServerSession mentioned only in a comment', () => {
        const synthetic = `// a raw getServerSession would let a denied member read\nexport const GET = withAuth({}, async () => {});`;
        expect(findRawSessionUse(stripComments(synthetic))).toBeNull();
    });

    it('flags a bare prisma handler with no wrapper', () => {
        const synthetic = `import prisma from "@/lib/prisma";\nexport async function GET() { return prisma.x.findMany(); }`;
        expect(findUnwrappedPrismaHandlers(stripComments(synthetic))).toHaveLength(1);
    });

    it('flags a const export assigned to a non-wrapper', () => {
        const synthetic = `import prisma from "@/lib/prisma";\nexport const GET = somethingElse(async () => prisma.x);`;
        expect(findUnwrappedPrismaHandlers(stripComments(synthetic))).toHaveLength(1);
    });

    it('accepts a withAuth-wrapped prisma handler (incl. generics)', () => {
        const synthetic = `import prisma from "@/lib/prisma";\nexport const PATCH = withAuth<{ params: Promise<{ id: string }> }>({}, async () => prisma.x);`;
        expect(findUnwrappedPrismaHandlers(stripComments(synthetic))).toEqual([]);
    });

    it('accepts a bare prisma handler that is a getOptionalSessionUser public-read', () => {
        const synthetic = `import prisma from "@/lib/prisma";\nimport { getOptionalSessionUser } from "@/lib/auth";\nexport async function GET(req) { const u = await getOptionalSessionUser(req); return prisma.x; }`;
        expect(findUnwrappedPrismaHandlers(stripComments(synthetic))).toEqual([]);
    });

    it('ignores a route that never touches prisma', () => {
        const synthetic = `export async function GET() { return Response.json({ ok: true }); }`;
        expect(findUnwrappedPrismaHandlers(stripComments(synthetic))).toEqual([]);
    });
});
