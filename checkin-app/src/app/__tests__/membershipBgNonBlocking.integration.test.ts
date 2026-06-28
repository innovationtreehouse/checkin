/**
 * @jest-environment node
 */
/**
 * Integration coverage for the non-blocking background-check flow.
 *
 * The check is now a PARALLEL track: after the contract is signed + consent is
 * given (or a valid prior check exists), the application advances straight to
 * PENDING_PAYMENT. The membership only goes ACTIVE once BOTH payment and the
 * check are done — whichever finishes last. A valid prior check auto-clears the
 * requirement; a reject after payment blocks (and would need a manual refund).
 */

import { markContractSigned, markBgConsent } from '@/lib/membership/external';
import { attest } from '@/lib/membership/review';
import { certifyPaymentPlan, activate } from '@/lib/membership/payment';
import { submitIntake } from '@/lib/membership/intake';
import prisma from '@/lib/prisma';

jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'bg-nonblocking-test';

async function makeReviewer(label: string): Promise<number> {
    const r = await prisma.participant.create({
        data: {
            email: `${label}-${TAG}@example.com`,
            name: label,
            backgroundCheckReviewer: true,
            household: { create: { name: `${label} HH ${TAG}` } },
        },
    });
    return r.id;
}

/** Applicant household + a lead + membership + a process at the given status. */
async function makeApplicant(status: 'PENDING_EXTERNAL_ACTION', extra: { lastBackgroundCheck?: Date } = {}) {
    const hh = await prisma.household.create({ data: { name: `Applicant ${TAG} ${Math.random()}` } });
    const lead = await prisma.participant.create({
        data: { email: `lead-${Math.random()}-${TAG}@example.com`, name: 'Lead Parent', householdId: hh.id, lastBackgroundCheck: extra.lastBackgroundCheck ?? null },
    });
    await prisma.householdLead.create({ data: { householdId: hh.id, participantId: lead.id } });
    const m = await prisma.membership.create({ data: { householdId: hh.id, status: 'NONE' } });
    const proc = await prisma.membershipProcess.create({ data: { membershipId: m.id, kind: 'INITIAL', status } });
    return { householdId: hh.id, membershipId: m.id, processId: proc.id, leadId: lead.id };
}

const statusOf = async (id: number) => (await prisma.membershipProcess.findUnique({ where: { id } }))?.status;
const membershipStatusOf = async (id: number) => (await prisma.membership.findUnique({ where: { id } }))?.status;

async function wipe() {
    const hhs = await prisma.household.findMany({
        where: { OR: [{ name: { contains: TAG } }, { participants: { some: { email: { contains: TAG } } } }] },
        select: { id: true },
    });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        await prisma.backgroundCheckAttestation.deleteMany({ where: { process: { membership: { householdId: { in: ids } } } } });
        await prisma.membershipProcess.deleteMany({ where: { membership: { householdId: { in: ids } } } });
        await prisma.membership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.emergencyContact.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.participant.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.participant.deleteMany({ where: { email: { contains: TAG } } });
}

describe('background check is non-blocking', () => {
    let revA: number, revB: number;
    let prevBgRecheckMonths = 0;

    beforeAll(async () => {
        await wipe();
        // BoardSettings (id=1) is a global singleton; remember what we change so the
        // auto-clear scenario doesn't pollute other suites' BoardSettings reads.
        prevBgRecheckMonths = (await prisma.boardSettings.findUnique({ where: { id: 1 } }))?.bgRecheckMonths ?? 0;
        revA = await makeReviewer('RevA');
        revB = await makeReviewer('RevB');
    });
    afterAll(async () => {
        await wipe();
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: prevBgRecheckMonths }, update: { bgRecheckMonths: prevBgRecheckMonths } });
        await prisma.$disconnect();
    });

    it('contract + consent advance to PENDING_PAYMENT (not BG review) — payment unblocked', async () => {
        const { processId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        expect(await statusOf(processId)).toBe('PENDING_EXTERNAL_ACTION'); // consent still missing
        await markBgConsent(processId, revA);
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT'); // payment available; review runs in parallel
    });

    it('pay before the check clears → holds at PENDING_BG_CLEARANCE, then 2 approvals activate', async () => {
        const { processId, membershipId, householdId, leadId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        // Pay first.
        await certifyPaymentPlan(processId, revA);
        expect(await statusOf(processId)).toBe('PENDING_BG_CLEARANCE');
        expect(await membershipStatusOf(membershipId)).toBe('NONE'); // NOT active without a valid check

        // Review clears in parallel; the 2nd approval converges to ACTIVE.
        await attest(revA, processId, { result: 'APPROVE' });
        expect(await statusOf(processId)).toBe('PENDING_BG_CLEARANCE');
        await attest(revB, processId, { result: 'APPROVE' });
        expect(await statusOf(processId)).toBe('ACTIVE');
        expect(await membershipStatusOf(membershipId)).toBe('ACTIVE');
        // Guardians' lastBackgroundCheck stamped.
        const lead = await prisma.participant.findUnique({ where: { id: leadId } });
        expect(lead?.lastBackgroundCheck).not.toBeNull();
        expect(householdId).toBeGreaterThan(0);
    });

    it('check clears before payment → stays PENDING_PAYMENT, then paying activates', async () => {
        const { processId, membershipId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        await attest(revA, processId, { result: 'APPROVE' });
        await attest(revB, processId, { result: 'APPROVE' });
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT'); // cleared, but unpaid → not active
        expect(await membershipStatusOf(membershipId)).toBe('NONE');
        await certifyPaymentPlan(processId, revA);
        expect(await statusOf(processId)).toBe('ACTIVE');
        expect(await membershipStatusOf(membershipId)).toBe('ACTIVE');
    });

    it('reject after payment → BLOCKED, membership stays inactive', async () => {
        const { processId, membershipId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        await certifyPaymentPlan(processId, revA); // paid → PENDING_BG_CLEARANCE
        await attest(revA, processId, { result: 'REJECT' });
        expect(await statusOf(processId)).toBe('BLOCKED');
        expect(await membershipStatusOf(membershipId)).toBe('NONE');
    });

    it('a still-valid prior check auto-clears at submit — no consent needed, pay activates directly', async () => {
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: 12 }, update: { bgRecheckMonths: 12 } });
        const { processId, membershipId, householdId } = await makeApplicant('PENDING_EXTERNAL_ACTION', { lastBackgroundCheck: new Date() });
        // Reset the process to INTAKE with the household fully filled so submitIntake passes validation.
        await prisma.membershipProcess.update({ where: { id: processId }, data: { status: 'INTAKE' } });
        await prisma.household.update({ where: { id: householdId }, data: { address: '123 Test St' } });
        await prisma.emergencyContact.create({ data: { householdId, name: 'Out Of House', phone: '555-555-1212', phoneDigits: '5555551212', priority: 0 } });
        const lead = await prisma.participant.findFirst({ where: { householdId, householdLeads: { some: { householdId } } } });

        await submitIntake(lead!.id);
        const proc = await prisma.membershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('PENDING_EXTERNAL_ACTION');
        expect(proc?.bgClearedAt).not.toBeNull(); // auto-validated

        // Contract alone advances (no BG consent needed), and paying activates immediately.
        await markContractSigned(processId);
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');
        await certifyPaymentPlan(processId, lead!.id);
        expect(await statusOf(processId)).toBe('ACTIVE');
        expect(await membershipStatusOf(membershipId)).toBe('ACTIVE');
    });

    it('paying twice is idempotent (one activation)', async () => {
        const { processId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        await attest(revA, processId, { result: 'APPROVE' });
        await attest(revB, processId, { result: 'APPROVE' }); // cleared, PENDING_PAYMENT
        // The idempotent payment path is the Shopify webhook (activate), which a
        // retry hits twice; the deliberate board certify rejects a non-payment phase.
        await activate(processId, { via: 'payment', shopifyOrderId: 'pay-1' }); // ACTIVE
        await activate(processId, { via: 'payment', shopifyOrderId: 'pay-2' }); // retry — no-op
        expect(await statusOf(processId)).toBe('ACTIVE');
        const audits = await prisma.auditLog.findMany({ where: { tableName: 'MembershipProcess', affectedEntityId: processId }, select: { newData: true } });
        const activations = audits.filter((a) => String(a.newData).includes('"status":"ACTIVE"')).length;
        expect(activations).toBe(1);
    });
});
