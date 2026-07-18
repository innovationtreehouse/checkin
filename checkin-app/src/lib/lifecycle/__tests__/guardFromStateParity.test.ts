import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    TRANSITIONS as ENROLL_TX,
    STATES as ENROLL_STATES,
    fromWhere as enrollFromWhere,
    type FromStateName as EnrollFrom,
} from '../../programs/enrollmentState';
import {
    TRANSITIONS as MEMB_TX,
    ALL_STATUSES as MEMB_STATES,
    fromWhere as membFromWhere,
    type ProcessStatus,
} from '../../membership/lifecycle';

/**
 * CAS guard ↔ TRANSITIONS from-state parity (#1080) — the real drift-closer.
 *
 * `TRANSITIONS` used to carry `guardSite` as a doc string only; each of the ~10 CAS
 * guards re-hand-wrote `where: { status: <FROM> }`, and nothing checked that literal
 * against the table. A status rename/split could desync a guard from its declared
 * transition silently.
 *
 * Now every migratable guard spreads `...fromWhere(<fromState>)`, sourcing its
 * from-state `status` clause from the ONE definition. This test pins that link:
 *
 *   1. `fromWhere(from)` emits exactly the from-state's identifying `status` clause.
 *   2. Each guard's declared from-state is a real node in that machine's TRANSITIONS,
 *      and (for forward guards) the declared `from → to` edge exists in the table.
 *   3. Migrated guards actually consume `fromWhere(<from>)` in source; guards left
 *      literal (documented) still carry their literal, and its status agrees with
 *      the definition.
 *
 * Because a status rename flows through the enum-parity line → the local union →
 * `fromWhere` → every spreading guard at once, a guard can no longer drift from the
 * table by construction; this test guards the pieces that aren't purely structural.
 */

const SRC = join(__dirname, '../../..'); // .../src

type GuardSite = {
    /** Source file, relative to src/. */
    file: string;
    machine: 'enrollment' | 'membership';
    /** The from-state the guard's CAS names (a state in that machine). */
    from: string;
    /** Forward transition the guard drives, as [from, to]; omit for a reverse/entry
     *  guard whose from-state has no outgoing table edge (e.g. unarchive from ARCHIVED). */
    edge?: [string, string];
    /** 'spread' = migrated onto fromWhere; 'literal' = intentionally kept literal. */
    mode: 'spread' | 'literal';
};

const GUARDS: GuardSite[] = [
    // ── enrollment (ProgramParticipant) ──
    { file: 'lib/programs/activateEnrollment.ts', machine: 'enrollment', from: 'PENDING_UNPAID', edge: ['PENDING_UNPAID', 'ACTIVE'], mode: 'spread' },
    { file: 'app/api/programs/[id]/request-payment-plan/route.ts', machine: 'enrollment', from: 'PENDING_UNPAID', edge: ['PENDING_UNPAID', 'PENDING_HELD'], mode: 'spread' },
    { file: 'app/api/programs/[id]/request-payment-plan/route.ts', machine: 'enrollment', from: 'PENDING_HELD_DENIED', edge: ['PENDING_HELD_DENIED', 'PENDING_HELD'], mode: 'spread' },
    { file: 'app/api/finance-ops/payment-plans/route.ts', machine: 'enrollment', from: 'PENDING_HELD', edge: ['PENDING_HELD', 'ACTIVE'], mode: 'spread' },
    { file: 'app/api/finance-ops/payment-plans/refuse/route.ts', machine: 'enrollment', from: 'PENDING_HELD', edge: ['PENDING_HELD', 'PENDING_HELD_DENIED'], mode: 'spread' },
    { file: 'app/api/finance-ops/payment-plans/manual-hold/route.ts', machine: 'enrollment', from: 'PENDING_HOLD_FAILED', edge: ['PENDING_HOLD_FAILED', 'PENDING_HELD'], mode: 'spread' },

    // ── membership (OrgMembershipProcess) ──
    { file: 'lib/membership/external.ts', machine: 'membership', from: 'PENDING_EXTERNAL_ACTION', edge: ['PENDING_EXTERNAL_ACTION', 'PENDING_PAYMENT'], mode: 'spread' },
    { file: 'lib/membership/renewal.ts', machine: 'membership', from: 'PENDING_RENEWAL', edge: ['PENDING_RENEWAL', 'PENDING_EXTERNAL_ACTION'], mode: 'spread' },
    { file: 'lib/membership/archive.ts', machine: 'membership', from: 'ARCHIVED', mode: 'spread' }, // unarchive: reverse of #13, no ARCHIVED→ edge
    { file: 'app/api/finance-ops/membership-payment-plans/route.ts', machine: 'membership', from: 'PENDING_PAYMENT', edge: ['PENDING_PAYMENT', 'ACTIVE'], mode: 'spread' },
    { file: 'app/api/finance-ops/membership-payment-plans/refuse/route.ts', machine: 'membership', from: 'PENDING_PAYMENT', mode: 'spread' }, // deny: clears the flag only, no status edge (stays PENDING_PAYMENT)

    // ── left literal on purpose (documented) ──
    // personBgTriggers is an idempotency EXISTENCE set (∅→PENDING_BG_REVIEW is the edge;
    // the guard's {in:[PENDING_BG_REVIEW,BLOCKED]} is broader than any from-state).
];

const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

function fromWhereOf(g: GuardSite) {
    return g.machine === 'enrollment' ? enrollFromWhere(g.from as EnrollFrom) : membFromWhere(g.from as ProcessStatus);
}

/** Recompute the expected identifying status clause independently of fromWhere, so a
 *  bug in fromWhere itself can't make the test tautological. Enrollment maps a
 *  from-state name to its status via STATES; membership's name IS the status. */
function expectedStatusWhere(g: GuardSite) {
    const statuses = g.machine === 'enrollment' ? ENROLL_STATES[g.from as EnrollFrom].statuses : [g.from];
    return statuses.length === 1 ? { status: statuses[0] } : { status: { in: [...statuses] } };
}

describe('CAS guard ↔ TRANSITIONS from-state parity (#1080)', () => {
    it('fromWhere emits exactly the from-state identifying status clause', () => {
        for (const g of GUARDS) {
            expect(fromWhereOf(g)).toEqual(expectedStatusWhere(g));
        }
    });

    it('every guard from-state is a real node in its machine', () => {
        for (const g of GUARDS) {
            const states: readonly string[] = g.machine === 'enrollment' ? Object.keys(ENROLL_STATES) : MEMB_STATES;
            expect(states).toContain(g.from);
        }
    });

    it('every declared forward edge exists in the machine TRANSITIONS table', () => {
        for (const g of GUARDS) {
            if (!g.edge) continue;
            const tx = g.machine === 'enrollment' ? ENROLL_TX : MEMB_TX;
            const [from, to] = g.edge;
            const found = tx.some((t) => t.from === from && t.to === to);
            expect({ site: g.file, edge: g.edge, found }).toEqual({ site: g.file, edge: g.edge, found: true });
        }
    });

    it('migrated guards consume fromWhere(<from>) for their from-state', () => {
        for (const g of GUARDS) {
            if (g.mode !== 'spread') continue;
            const src = read(g.file);
            const re = new RegExp(`fromWhere\\(\\s*['"]${g.from}['"]\\s*\\)`);
            expect({ site: g.file, from: g.from, spreads: re.test(src) }).toEqual({ site: g.file, from: g.from, spreads: true });
        }
    });

    it('the personBg idempotency guard is left literal, and its states are valid', () => {
        const src = read('lib/membership/personBgTriggers.ts');
        // still a raw {in:[…]} literal (NOT fromWhere) — documented as an existence set
        expect(/status:\s*\{\s*in:\s*\[\s*"PENDING_BG_REVIEW",\s*"BLOCKED"\s*\]/.test(src)).toBe(true);
        expect(src).not.toMatch(/fromWhere\(/);
        for (const s of ['PENDING_BG_REVIEW', 'BLOCKED']) expect(MEMB_STATES).toContain(s);
    });
});
