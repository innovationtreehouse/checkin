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
 * Three rules, each with an explicit, comment-justified allowlist as the ONLY
 * escape hatch:
 *   1. No raw `getServerSession` / `authOptions` in a route file. Use
 *      withAuth/handler (mandatory session), getOptionalSessionUser /
 *      authenticateRequest (optional/public session, lib/auth.ts), or
 *      withCron/withWebhook/withKiosk (non-session).
 *   2. A route that touches `prisma` must enter through one of those wrappers
 *      (or a public-read via getOptionalSessionUser/authenticateRequest). A bare
 *      `export async function GET/POST(...)` that hits prisma with no wrapper =
 *      drift.
 *   3. A GET/HEAD handler that READS an edge-sensitive model (ProgramParticipant,
 *      ProgramVolunteer, RSVP, Visit) must be on EDGE_INCLUDE_ALLOWLIST with a
 *      note on how it gates the edge. These models are all-public-tier, so the
 *      SENSITIVE thing is the existence of the row (who's enrolled / RSVP'd /
 *      present), not any field — per-field stripping can't protect them, and
 *      `_count` leaks the roster size even if tiered (the pre-#575 programs/[id]
 *      leak). Writes are out of scope here (GAP-2), so only GET/HEAD handlers
 *      are scanned. Edge reads via lib helpers (e.g. attendance → scan-service)
 *      are invisible to a route-file scan and rely on the validator gate's
 *      `returns:`/stripping instead.
 */
import * as fs from 'fs';
import * as path from 'path';
import { relations } from '@/security/generated/classifications';

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

// ---------------------------------------------------------------------------
// Rule 3 — edge-sensitive model reads (see §11 / §5.1a of the analysis doc).
// ---------------------------------------------------------------------------

/** Models whose rows are sensitive by EXISTENCE — all their fields are public
 * tier, so stripping can't protect them and a returned row (or _count) leaks
 * "who's enrolled / RSVP'd / present". */
const EDGE_MODELS = new Set(['ProgramParticipant', 'ProgramVolunteer', 'RSVP', 'Visit']);

/** Relation keys that resolve EXCLUSIVELY to an edge model, derived from the
 * generated relations map (NOT hard-coded) so a relation rename can't slip past
 * the guard. A key shared with a non-edge model (e.g. `participants`, which is
 * Household→Participant as well as Program→ProgramParticipant) is intentionally
 * excluded — it's ambiguous, and every genuine edge use of it is independently
 * caught by a sibling unambiguous key or a direct edge read. */
const EDGE_RELATION_KEYS: string[] = (() => {
    const byKey = new Map<string, Set<string>>();
    for (const parent of Object.values(relations as Record<string, Record<string, { model: string }>>)) {
        for (const [key, { model }] of Object.entries(parent)) {
            if (!byKey.has(key)) byKey.set(key, new Set());
            byKey.get(key)!.add(model);
        }
    }
    return [...byKey.entries()]
        .filter(([, models]) => [...models].every((m) => EDGE_MODELS.has(m)))
        .map(([key]) => key);
})();

/** Prisma client property for each edge model (first char lower-cased, Prisma's
 * convention: `RSVP` → `rSVP`). */
const EDGE_PROPS = [...EDGE_MODELS].map((m) => m[0].toLowerCase() + m.slice(1));

const READ_OPS = 'findMany|findUnique|findFirst|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy';
const EDGE_READ_RE = new RegExp(`prisma\\.(${EDGE_PROPS.join('|')})\\.(${READ_OPS})`, 'g');
const EDGE_INCLUDE_RE = new RegExp(`\\b(${EDGE_RELATION_KEYS.join('|')})\\s*:\\s*(?:true|\\{)`, 'g');
const HANDLER_RE = new RegExp(
    `export\\s+(?:const|async\\s+function)\\s+(${HTTP_METHODS})\\b`,
    'g',
);

/** The exported HTTP method whose body contains index `idx` (nearest preceding
 * `export const/function METHOD`), or null. */
function enclosingMethod(code: string, idx: number): string | null {
    let cur: string | null = null;
    HANDLER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = HANDLER_RE.exec(code))) {
        if (m.index < idx) cur = m[1];
        else break;
    }
    return cur;
}

/** Rule 3: edge models READ inside a GET/HEAD handler (response-leak surface).
 * Writes (POST/PATCH/...) are GAP-2, not this rule. Returns the set of edge
 * models/keys surfaced, or []. */
function findEdgeReadsInReads(code: string): string[] {
    const found = new Set<string>();
    for (const re of [EDGE_READ_RE, EDGE_INCLUDE_RE]) {
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(code))) {
            const method = enclosingMethod(code, m.index);
            if (method === 'GET' || method === 'HEAD') found.add(m[1]);
        }
    }
    return [...found];
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

// Routes whose GET/HEAD handler returns edge-sensitive rows. Each MUST gate the
// edge; the note says how — admission-gated (authorize/role rejects unauthorized
// callers), query-shaped (only returns the edge for authorized callers, like
// programs/[id] post-#575), admin-role-gated, or cron/webhook-gated (non-session
// service auth). Keys are the route dir (no /route.ts). Adding a row here is a
// reviewed assertion that the edge is protected.
const EDGE_INCLUDE_ALLOWLIST: Record<string, string> = {
    'cron/nightly': 'cron-gated — withCron, no user-facing response',
    'cron/pending-participants': 'cron-gated — withCron, no user-facing response',
    'cron/reminders': 'cron-gated — withCron, reads RSVPs to send reminders',
    'events/[id]': 'admission-gated — handler GET throws forbidden() unless staff (sysadmin/board/leadMentor/coreVol)',
    'events/mine': 'query-shaped — self + own household only (activityMembers → where participantId in memberIds)',
    'facility/trends': 'admin-role-gated — sysadmin/board',
    'facility/visits': 'admin-role-gated — sysadmin/board',
    'finance-ops/payment-plans': 'admin-role-gated — registry authorize anyRole [sysadmin, board]',
    'household/visits': "query-shaped — own household only (where householdId = caller's)",
    'kioskdisplay/certifications': 'admin-role-gated — sysadmin/board/keyholder (+ kiosk)',
    'membership-ops/participants/merge/analyze': 'admin-role-gated — sysadmin/board',
    'nav/todo-counts': 'query-shaped — counts scoped to caller (own household + programs the caller leads)',
    'profile': "query-shaped — authorize 'self'; visits are the caller's own",
    'profile/visits': 'query-shaped — self only (where participantId = caller)',
    'programs/[id]/eligible-participants': 'admission-gated — authorize program-lead-mentor; edge keys used only as where-filters',
    'programs/[id]': 'query-shaped — participants/volunteers included only for staff/enrolled (#575)',
    'programs/mine': 'query-shaped — self + household only (where participantId in memberIds)',
    'programs': 'query-shaped — public catalog exposes _count of participants/volunteers (roster SIZE only, no identities/rows); member-only + draft visibility is gated',
    'safety/emergency-contacts': 'admin-role-gated — sysadmin/board/keyholder',
    'trusted-adults/operational': "admission-gated + query-shaped — authorize 'authenticated'; leads scoped to own-program households (where householdId in [...])",
};

const FIX_3 =
    'These models are all-public-tier, so the existence of the row is sensitive even ' +
    'though the fields are public (see §11 / §5.1a) — per-field stripping cannot protect it. ' +
    'Confirm the GET/HEAD handler admission-gates, query-shapes, or admin-role-gates this edge, ' +
    'then add it to EDGE_INCLUDE_ALLOWLIST with the justification.';

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

    describe('rule 3 — edge-sensitive reads in GET/HEAD must be allowlisted', () => {
        it('derives edge relation keys from the generated map (not hard-coded)', () => {
            // Sanity: the map yields the unambiguous edge keys and excludes the
            // shared `participants` key. If this changes, the derivation broke.
            expect(EDGE_RELATION_KEYS.sort()).toEqual(
                ['programParticipants', 'programVolunteers', 'rsvps', 'visits', 'volunteers'].sort(),
            );
            expect(EDGE_RELATION_KEYS).not.toContain('participants');
        });

        for (const { rel, code } of routeFiles) {
            if (ALLOWLIST.has(rel)) continue;
            const key = rel.replace(/\/route\.ts$/, '');
            const edges = findEdgeReadsInReads(code);
            const msg =
                edges.length && !(key in EDGE_INCLUDE_ALLOWLIST)
                    ? `Route ${key} includes edge model(s) ${edges.join(', ')}. ${FIX_3}`
                    : null;
            it(rel, () => {
                expect(msg).toBeNull();
            });
        }

        it('every EDGE_INCLUDE_ALLOWLIST entry is still a live includer (no dead exemptions)', () => {
            const flagged = new Set(
                routeFiles
                    .filter(({ code }) => findEdgeReadsInReads(code).length > 0)
                    .map(({ rel }) => rel.replace(/\/route\.ts$/, '')),
            );
            const dead = Object.keys(EDGE_INCLUDE_ALLOWLIST).filter((k) => !flagged.has(k));
            expect(dead).toEqual([]);
        });
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

    it('flags a direct edge-model read in a GET handler', () => {
        const synthetic = `export const GET = withAuth({}, async () => prisma.visit.findMany());`;
        expect(findEdgeReadsInReads(stripComments(synthetic))).toContain('visit');
    });

    it('flags an edge relation include in a GET handler', () => {
        const synthetic = `export const GET = handler('x', async () => prisma.program.findUnique({ include: { volunteers: true } }));`;
        expect(findEdgeReadsInReads(stripComments(synthetic))).toContain('volunteers');
    });

    it('flags an edge _count in a GET handler (roster size)', () => {
        const synthetic = `export const GET = withAuth({}, async () => prisma.program.findMany({ include: { _count: { select: { volunteers: true } } } }));`;
        expect(findEdgeReadsInReads(stripComments(synthetic))).toContain('volunteers');
    });

    it('does NOT flag an edge read in a write handler (POST — GAP-2, not rule 3)', () => {
        const synthetic = `export const POST = withAuth({}, async () => prisma.rSVP.create({ data: {} }) && prisma.programParticipant.findUnique({}));`;
        expect(findEdgeReadsInReads(stripComments(synthetic))).toEqual([]);
    });

    it('does NOT flag the ambiguous `participants` key (Household→Participant, not edge)', () => {
        const synthetic = `export const GET = withAuth({}, async () => prisma.household.findUnique({ include: { participants: true } }));`;
        expect(findEdgeReadsInReads(stripComments(synthetic))).toEqual([]);
    });
});
