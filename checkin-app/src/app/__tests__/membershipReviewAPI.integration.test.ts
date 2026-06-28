/**
 * @jest-environment node
 */
/**
 * Integration tests for the PENDING_BG_REVIEW phase: 2-of-N attestation,
 * eligibility rules, sticky volunteer status, reject -> BLOCKED, board override.
 */

import { GET as REVIEW_QUEUE, POST as ATTEST } from '@/app/api/membership/reviews/route';
import { POST as OVERRIDE } from '@/app/api/admin/membership/review-override/route';
import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth/next';

jest.mock('next-auth/next', () => ({ getServerSession: jest.fn() }));
// Don't hit Resend during tests — the reviewer ping is exercised, not actually sent.
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'review-test';

function as(id: number, roles: { backgroundCheckReviewer?: boolean; boardMember?: boolean; sysadmin?: boolean } = {}) {
    (getServerSession as jest.Mock).mockResolvedValue({ user: { id, sysadmin: false, boardMember: false, backgroundCheckReviewer: false, ...roles } });
}
function req(body: unknown) {
    return new Request('http://localhost:4000/x', { method: 'POST', body: JSON.stringify(body) }) as unknown as Parameters<typeof ATTEST>[0];
}

describe('Membership BG review API', () => {
    let rev1: number, rev2: number, rev1b: number, revInApplicant: number, nonReviewer: number, board: number;
    let applicantHh: number;

    async function makeApplicantProcess(label: string, parentEmail?: string) {
        const hh = await prisma.household.create({ data: { name: `${label} ${TAG}` } });
        // A parent/guardian is a household lead.
        const parent = await prisma.participant.create({ data: { name: `${label} Parent`, householdId: hh.id, ...(parentEmail ? { email: parentEmail } : {}) } });
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: parent.id } });
        const m = await prisma.membership.create({ data: { householdId: hh.id, status: 'NONE' } });
        const p = await prisma.membershipProcess.create({ data: { membershipId: m.id, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' } });
        return { householdId: hh.id, membershipId: m.id, processId: p.id };
    }

    async function wipe() {
        const hhs = await prisma.household.findMany({ where: { OR: [{ name: { contains: TAG } }, { participants: { some: { email: { contains: TAG } } } }] }, select: { id: true } });
        const ids = hhs.map((h) => h.id);
        if (ids.length) {
            await prisma.backgroundCheckAttestation.deleteMany({ where: { process: { membership: { householdId: { in: ids } } } } });
            await prisma.membershipProcess.deleteMany({ where: { membership: { householdId: { in: ids } } } });
            await prisma.membership.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
            await prisma.household.deleteMany({ where: { id: { in: ids } } });
        }
        await prisma.volunteerDesignation.deleteMany({ where: { email: { contains: TAG } } });
        await prisma.participant.deleteMany({ where: { email: { contains: TAG } } });
    }

    beforeAll(async () => {
        await wipe();
        const mk = async (slug: string, role: object, householdId?: number) => {
            const data = householdId
                ? { email: `${slug}-${TAG}@example.com`, name: slug, householdId, ...role }
                : { email: `${slug}-${TAG}@example.com`, name: slug, household: { create: { name: `${slug} HH ${TAG}` } }, ...role };
            return prisma.participant.create({ data });
        };
        const r1 = await mk('rev1', { backgroundCheckReviewer: true });
        rev1 = r1.id;
        rev1b = (await mk('rev1b', { backgroundCheckReviewer: true }, r1.householdId!)).id; // shares rev1's household
        rev2 = (await mk('rev2', { backgroundCheckReviewer: true })).id;
        board = (await mk('board', { boardMember: true })).id;
        nonReviewer = (await mk('plain', {})).id;

        const app = await makeApplicantProcess('Applicant');
        applicantHh = app.householdId;
        revInApplicant = (await mk('revapp', { backgroundCheckReviewer: true }, applicantHh)).id; // in applicant household
    });

    afterAll(async () => {
        await wipe();
        await prisma.$disconnect();
    });

    it('rejects a non-reviewer (403)', async () => {
        as(nonReviewer);
        const proc = await makeApplicantProcess('NR');
        const res = await ATTEST(req({ processId: proc.processId, result: 'APPROVE' }) as never);
        expect(res.status).toBe(403);
    });

    it('blocks a reviewer in the applicant household', async () => {
        as(revInApplicant, { backgroundCheckReviewer: true });
        const proc = await prisma.membershipProcess.findFirst({ where: { membership: { householdId: applicantHh } } });
        const res = await ATTEST(req({ processId: proc!.id, result: 'APPROVE' }) as never);
        const data = await res.json();
        expect(res.status).toBe(403);
        expect(data.code).toBe('same_household_applicant');
    });

    it('2 distinct reviewers approving advances to PENDING_PAYMENT, stamps BG date, applies marked volunteer', async () => {
        const proc = await makeApplicantProcess('Approve');
        as(rev1, { backgroundCheckReviewer: true });
        const r1 = await ATTEST(req({ processId: proc.processId, result: 'APPROVE' }) as never);
        expect((await r1.json()).outcome.status).toBe('PENDING_BG_REVIEW');

        // same reviewer again -> already_attested
        const dup = await ATTEST(req({ processId: proc.processId, result: 'APPROVE' }) as never);
        expect(dup.status).toBe(409);

        // reviewer sharing rev1's household -> blocked
        as(rev1b, { backgroundCheckReviewer: true });
        const shared = await ATTEST(req({ processId: proc.processId, result: 'APPROVE' }) as never);
        expect((await shared.json()).code).toBe('same_household_reviewer');

        // rev2 approves with volunteer checkbox -> advances
        as(rev2, { backgroundCheckReviewer: true });
        const r2 = await ATTEST(req({ processId: proc.processId, result: 'APPROVE', markedVolunteer: true }) as never);
        expect((await r2.json()).outcome.status).toBe('PENDING_PAYMENT');

        const updated = await prisma.membershipProcess.findUnique({ where: { id: proc.processId } });
        expect(updated?.status).toBe('PENDING_PAYMENT');
        const membership = await prisma.membership.findUnique({ where: { id: proc.membershipId } });
        expect(membership?.isVolunteer).toBe(true);
        const parent = await prisma.participant.findFirst({ where: { householdId: proc.householdId, householdLeads: { some: { householdId: proc.householdId } } } });
        expect(parent?.lastBackgroundCheck).not.toBeNull();

        // The advance audit records the reviewer whose attestation triggered it (rev2), not rev1/SYSTEM.
        const audits = await prisma.auditLog.findMany({ where: { tableName: 'MembershipProcess', affectedEntityId: proc.processId }, orderBy: { id: 'desc' } });
        const advance = audits.find((a) => String(a.newData).includes('"status":"PENDING_PAYMENT"'));
        expect(advance?.actorId).toBe(rev2);
    });

    it('applies volunteer status from a pre-designation (dot-insensitive), without a checkbox', async () => {
        const proc = await makeApplicantProcess('Predesig', `vol.parent-${TAG}@example.com`);
        await prisma.volunteerDesignation.create({ data: { email: `volparent-${TAG}@example.com` } }); // no dot
        as(rev1, { backgroundCheckReviewer: true });
        await ATTEST(req({ processId: proc.processId, result: 'APPROVE' }) as never);
        as(rev2, { backgroundCheckReviewer: true });
        await ATTEST(req({ processId: proc.processId, result: 'APPROVE' }) as never);
        const membership = await prisma.membership.findUnique({ where: { id: proc.membershipId } });
        expect(membership?.isVolunteer).toBe(true);
    });

    it('a single REJECT blocks the application', async () => {
        const proc = await makeApplicantProcess('Reject');
        as(rev1, { backgroundCheckReviewer: true });
        const res = await ATTEST(req({ processId: proc.processId, result: 'REJECT' }) as never);
        expect((await res.json()).outcome.status).toBe('BLOCKED');
        const updated = await prisma.membershipProcess.findUnique({ where: { id: proc.processId } });
        expect(updated?.status).toBe('BLOCKED');

        // The BLOCKED audit records the rejecting reviewer.
        const audit = await prisma.auditLog.findFirst({ where: { tableName: 'MembershipProcess', affectedEntityId: proc.processId }, orderBy: { id: 'desc' } });
        expect(audit?.actorId).toBe(rev1);
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ status: 'BLOCKED' });
    });

    it('board reset on a BLOCKED app clears attestations and returns it to review', async () => {
        const proc = await makeApplicantProcess('ResetMe');
        as(rev1, { backgroundCheckReviewer: true });
        await ATTEST(req({ processId: proc.processId, result: 'REJECT' }) as never);

        as(board, { boardMember: true });
        const res = await OVERRIDE(req({ processId: proc.processId, action: 'reset' }) as never);
        expect(res.status).toBe(200);
        const updated = await prisma.membershipProcess.findUnique({ where: { id: proc.processId } });
        expect(updated?.status).toBe('PENDING_BG_REVIEW');
        const count = await prisma.backgroundCheckAttestation.count({ where: { processId: proc.processId } });
        expect(count).toBe(0);

        // The reset audit records the acting board member and the action.
        const audit = await prisma.auditLog.findFirst({ where: { tableName: 'MembershipProcess', affectedEntityId: proc.processId }, orderBy: { id: 'desc' } });
        expect(audit?.actorId).toBe(board);
        expect(JSON.parse(String(audit?.newData))).toMatchObject({ action: 'board reset' });
    });

    it('board override-approve on a BLOCKED app forces it to PENDING_PAYMENT', async () => {
        const proc = await makeApplicantProcess('ForceApprove');
        as(rev1, { backgroundCheckReviewer: true });
        await ATTEST(req({ processId: proc.processId, result: 'REJECT' }) as never);

        as(board, { boardMember: true });
        const res = await OVERRIDE(req({ processId: proc.processId, action: 'approve' }) as never);
        expect(res.status).toBe(200);
        const updated = await prisma.membershipProcess.findUnique({ where: { id: proc.processId } });
        expect(updated?.status).toBe('PENDING_PAYMENT');

        // The advance audit records the acting board member.
        const audits = await prisma.auditLog.findMany({ where: { tableName: 'MembershipProcess', affectedEntityId: proc.processId }, orderBy: { id: 'desc' } });
        const advance = audits.find((a) => String(a.newData).includes('"status":"PENDING_PAYMENT"'));
        expect(advance?.actorId).toBe(board);
    });

    it('non-board cannot override', async () => {
        as(nonReviewer);
        const res = await OVERRIDE(req({ processId: 1, action: 'reset' }) as never);
        expect(res.status).toBe(403);
    });

    it('queue lists eligible apps for a reviewer and excludes their own-household applicants', async () => {
        as(rev2, { backgroundCheckReviewer: true });
        const res = await REVIEW_QUEUE(req({}) as never);
        const data = await res.json();
        expect(Array.isArray(data.queue)).toBe(true);
        // Model-shaped rows now: id + _count.attestations + household leads (parents).
        for (const item of data.queue) {
            expect(typeof item.id).toBe('number');
            expect(item._count).toBeDefined();
        }
    });

    it('queue returns only parents (leads) and never exposes children', async () => {
        // Self-contained applicant household: one parent (lead) + one child (non-lead).
        const hh = await prisma.household.create({ data: { name: `ChildExcl ${TAG}` } });
        const parent = await prisma.participant.create({ data: { name: 'Excl Parent', email: `exclparent-${TAG}@example.com`, householdId: hh.id } });
        await prisma.householdLead.create({ data: { householdId: hh.id, participantId: parent.id } });
        await prisma.participant.create({ data: { name: 'Excl Child', email: `exclchild-${TAG}@example.com`, householdId: hh.id } });
        const m = await prisma.membership.create({ data: { householdId: hh.id, status: 'NONE' } });
        await prisma.membershipProcess.create({ data: { membershipId: m.id, kind: 'INITIAL', status: 'PENDING_BG_REVIEW' } });

        as(rev2, { backgroundCheckReviewer: true }); // different household → eligible
        const data = await (await REVIEW_QUEUE(req({}) as never)).json();
        const blob = JSON.stringify(data);

        // Parent (lead) is present; the child's PII never leaves the server.
        expect(blob).toContain('Excl Parent');
        expect(blob).toContain('exclparent');
        expect(blob).not.toContain('Excl Child');
        expect(blob).not.toContain('exclchild');
    });
});
