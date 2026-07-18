import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Status-literal allowlist drift guard (LIFECYCLE_ARCHITECTURE §5) — the lifecycle
 * analogue of EDGE_INCLUDE_ALLOWLIST / authzRegistry.test.ts.
 *
 * A raw `where: { status: <literal> }` on the ProgramParticipant or
 * OrgMembershipProcess models is a hand-encoded state-set that can silently drift
 * from the ONE definition in the machine module. This test scans src for every
 * such literal and asserts it appears ONLY in:
 *   - the definition modules (enrollmentState.ts, membership/lifecycle.ts,
 *     lib/lifecycle/*) — the single source of "what is legal"; or
 *   - the ALLOWLIST below: CAS transition-guard sites (which keep a literal `where`
 *     on purpose — they encode a *transition*, "from-state ∧ nothing-changed", not a
 *     state-set) plus a handful of read/query filters not yet migrated onto a
 *     StateSet.where.
 *
 * A new raw `where: { status: … }` anywhere else fails CI, forcing the author to
 * either consume a StateSet or register here with a justification — exactly how a
 * new sensitive `include` must earn an EDGE_INCLUDE_ALLOWLIST entry.
 *
 * The irreducibly-human call (is a new `where` a duplicate of a StateSet or a
 * legitimately-new transition guard?) is what the allowlist forces into review; a
 * person answers it. Everything above is machine-checked.
 *
 * Scope / precision (a deliberate, documented simplification):
 *   - Only `where:{…}` blocks are scanned — `data:`/`oldData:`/`newData:` writes and
 *     `p.status === '…'` comparisons are NOT state-set drift and are ignored.
 *   - Distinctive OrgMembershipProcessStatus literals (INTAKE, PENDING_BG_REVIEW, …)
 *     are attributed unambiguously. The two SHARED literals `ACTIVE`/`PENDING` also
 *     appear in OrgMembershipStatus/RSVPStatus/etc, so they are counted only when a
 *     `programParticipant` / `orgMembershipProcess` Prisma delegate sits just before
 *     the `where` (model attribution). A shared literal on some other model's `where`
 *     is correctly out of scope.
 */

const SRC = join(__dirname, '..');

const PP_LITERALS = ['PENDING', 'ACTIVE'] as const;
const OMP_LITERALS = [
    'INTAKE',
    'PENDING_EXTERNAL_ACTION',
    'PENDING_BG_REVIEW',
    'PENDING_PAYMENT',
    'PENDING_BG_CLEARANCE',
    'ACTIVE',
    'BLOCKED',
    'PENDING_RENEWAL',
    'RENEWAL_PENDING_BG',
    'ARCHIVED',
] as const;
const SHARED = new Set<string>(PP_LITERALS); // ACTIVE / PENDING — ambiguous across enums
const OMP_DISTINCT = OMP_LITERALS.filter((l) => !SHARED.has(l));
const ALL_LITERALS = [...new Set<string>([...PP_LITERALS, ...OMP_LITERALS])];

// Always-allowed: the definition layer itself is where literals are supposed to live.
function isDefinitionModule(rel: string): boolean {
    const p = rel.split(sep).join('/');
    return (
        p.startsWith('lib/lifecycle/') ||
        p === 'lib/programs/enrollmentState.ts' ||
        p === 'lib/membership/lifecycle.ts'
    );
}

/**
 * Every non-definition source file that keeps a raw status `where` literal on one of
 * the two models, each with a justification. `T#` = the transition id from the state
 * machine docs. New entries need a real reason; a stale one (no literal left) also
 * fails, keeping the list honest.
 */
const ALLOWLIST: Record<string, string> = {
    // ── enrollment (ProgramParticipant) CAS transition guards ──
    'lib/programs/activateEnrollment.ts': 'T4 activate CAS: where status=PENDING → ACTIVE (from-state guard).',
    'app/api/programs/[id]/request-payment-plan/route.ts':
        'T3/T3f apply CAS: where status=PENDING (+ held null / not-null) — encodes the apply transition.',
    'app/api/finance-ops/payment-plans/route.ts': 'T5 approve CAS: where isPaymentPlanRequested,status=PENDING.',
    'app/api/finance-ops/payment-plans/refuse/route.ts': 'T6 deny CAS: where isPaymentPlanRequested,status=PENDING.',
    'app/api/finance-ops/payment-plans/manual-hold/route.ts':
        'T3m manual-hold CAS: where status=PENDING,inventoryHeldAt null,isPaymentPlanRequested.',

    // ── membership (OrgMembershipProcess) CAS transition guards ──
    'app/api/finance-ops/membership-payment-plans/route.ts':
        'Membership grant CAS + probe: where status=PENDING_PAYMENT (payable-renewal guard).',
    'lib/membership/external.ts': 'advanceExternalIfComplete CAS (#7): where status=PENDING_EXTERNAL_ACTION.',
    'lib/membership/renewal.ts': 'beginRenewal CAS (#4): where status=PENDING_RENEWAL → PENDING_EXTERNAL_ACTION.',
    'lib/membership/archive.ts': 'unarchive CAS (#13): where status=ARCHIVED → restore target (idempotent).',
    'lib/membership/personBgTriggers.ts':
        'PERSON_BG create idempotency guard: where status in {PENDING_BG_REVIEW,BLOCKED}.',

    // ── read / query / probe filters (not yet migrated onto a StateSet.where) ──
    'app/api/facility/trends/route.ts': 'Read query: count ACTIVE enrollments for the trends view.',
    'app/api/membership-audit/compliance/route.ts': 'Read query: compliance count of PENDING_BG_CLEARANCE processes.',
    'app/api/membership-ops/applications/route.ts':
        'Board application list: archived (ARCHIVED) vs live (notIn ACTIVE,ARCHIVED).',
    'app/api/membership/renewal-status/route.ts': 'Member probe: this household’s RENEWAL at PENDING_RENEWAL.',
    'app/api/nav/todo-counts/route.ts': 'Dashboard counts: PENDING enrollments + member-actionable membership statuses.',
    'app/api/finance-ops/s-read/match-audit/track/route.ts':
        'Track-button staleness probes: claim re-check excluding ARCHIVED before promoting a gap — human-per-row, mirrors the matchAudit entry.',
    'lib/finance/matchAudit.ts':
        'Audit read queries: activation sweep (ACTIVE/PENDING_BG_CLEARANCE + ACTIVE participants) and the claim lookup excluding ARCHIVED — report-only, mirrors the reconcile.ts entry.',
    'lib/finance/reconcile.ts': 'Reconciler lookups: pending/active order-to-row matching on both models.',
    'lib/membership/notifications.ts': 'Read query: board BLOCKED-process count for the notifications badge.',
    'lib/membership/payment.ts': 'Read query: this household’s PENDING_PAYMENT process before activate.',
    'lib/membership/personBgSubmit.ts': 'Read query: the subject’s PERSON_BG process at PENDING_BG_REVIEW.',
    'lib/orgMembership.ts': 'Read query: latest settled OrgMembershipProcess (status=ACTIVE) for the login horizon.',

    // ── dev-only tooling ──
    'app/api/dev/shopify/orders-paid/route.ts': 'Dev webhook simulator: finds PENDING enrollments to fake a paid order.',
    'app/dev/shopify/page.tsx': 'Dev tool listing: PENDING enrollments + PENDING_PAYMENT processes.',
};

// ── scanner ──────────────────────────────────────────────────────────────────

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

/** Capture the object literal at/after `from`, skipping strings & comments so a
 *  brace inside them can't unbalance the scan. */
function captureObject(s: string, from: number): string | null {
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
            if (depth === 0) return s.slice(start, i + 1);
        }
    }
    return null;
}

// `where: {`  or  `where: cond ? {`  (a ternary whose first branch is the filter)
const WHERE_RE = /where\s*:\s*(?:[A-Za-z_$][\w.$]*\s*\?\s*)?\{/g;
// A status value expression: a quoted literal, or a `{ in: [...] }` / `{ not: … }`
// filter object (no nested braces — statuses never carry one).
const STATUS_VAL_RE = /status\s*:\s*(\{[^{}]*\}|'[^']*'|"[^"]*")/g;

/** Files with a raw status where-literal on ProgramParticipant / OrgMembershipProcess. */
function scan(): Set<string> {
    const hits = new Set<string>();
    for (const file of walk(SRC)) {
        const src = readFileSync(file, 'utf8');
        const rel = relative(SRC, file);
        WHERE_RE.lastIndex = 0;
        let wm: RegExpExecArray | null;
        while ((wm = WHERE_RE.exec(src))) {
            const body = captureObject(src, wm.index);
            if (!body) continue;
            const pre = src.slice(Math.max(0, wm.index - 240), wm.index);
            const isPP = /\bprogramParticipant\b/.test(pre);
            const isOMP = /\borgMembershipProcess\b/.test(pre);
            STATUS_VAL_RE.lastIndex = 0;
            let vm: RegExpExecArray | null;
            while ((vm = STATUS_VAL_RE.exec(body))) {
                const expr = vm[1];
                for (const lit of ALL_LITERALS) {
                    if (!new RegExp(`['"]${lit}['"]`).test(expr)) continue;
                    const inScope =
                        (OMP_DISTINCT as readonly string[]).includes(lit) || // unambiguous OMP literal
                        (isPP && (PP_LITERALS as readonly string[]).includes(lit)) ||
                        (isOMP && (OMP_LITERALS as readonly string[]).includes(lit));
                    if (inScope) hits.add(rel.split(sep).join('/'));
                }
            }
        }
    }
    return hits;
}

describe('lifecycle status-literal allowlist drift guard', () => {
    const flagged = [...scan()].filter((f) => !isDefinitionModule(f));
    const known = new Set(Object.keys(ALLOWLIST));

    it('no raw status where-literal outside the definition modules + allowlist', () => {
        const unexpected = flagged.filter((f) => !known.has(f)).sort();
        // A new one of these must consume a StateSet.where or be added to ALLOWLIST
        // with a justification (see LIFECYCLE_ARCHITECTURE §5).
        expect(unexpected).toEqual([]);
    });

    it('has no stale allowlist entry (a listed file no longer keeps a status where-literal)', () => {
        const live = new Set(flagged);
        const stale = [...known].filter((f) => !live.has(f)).sort();
        expect(stale).toEqual([]);
    });
});
