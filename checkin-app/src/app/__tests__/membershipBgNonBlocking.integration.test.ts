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
import { normalizeAuditData } from '@/lib/auditPayload';
import { attest, overrideBlocked } from '@/lib/membership/review';
import { certifyPaymentPlan, activate } from '@/lib/membership/payment';
import { submitIntake } from '@/lib/membership/intake';
import { beginRenewal } from '@/lib/membership/renewal';
import prisma from '@/lib/prisma';
import { sendEmail } from '@/lib/email';

jest.mock('@/lib/email', () => ({
    sendEmail: jest.fn().mockResolvedValue(true),
    runPaced: (tasks: Array<() => Promise<unknown>>) => Promise.all(tasks.map((t) => t())),
}));

const TAG = 'bg-nonblocking-test';

async function makeReviewer(label: string): Promise<number> {
    const r = await prisma.person.create({
        data: {
            email: `${label}-${TAG}@example.com`,
            name: label,
            isBackgroundCheckReviewer: true,
            household: { create: { name: `${label} HH ${TAG}` } },
        },
    });
    return r.id;
}

/** A board member (notifyBoardPaidReject's recipient) in their own household. */
async function makeBoardMember(): Promise<number> {
    const r = await prisma.person.create({
        data: { email: `board-${TAG}@example.com`, name: 'Board', isBoardMember: true, household: { create: { name: `Board HH ${TAG}` } } },
    });
    return r.id;
}

/** ACTIVE membership + lead with a valid prior check + a PENDING_RENEWAL process. */
async function makeFreshRenewal() {
    const hh = await prisma.household.create({ data: { name: `Renewal ${TAG} ${Math.random()}` } });
    const lead = await prisma.person.create({
        data: { email: `rlead-${Math.random()}-${TAG}@example.com`, name: 'R Lead', householdId: hh.id, lastBackgroundCheck: new Date() },
    });
    await prisma.person.update({ where: { id: lead.id }, data: { isHouseholdLead: true } });
    const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'ACTIVE' } });
    const proc = await prisma.orgMembershipProcess.create({ data: { orgMembershipId: m.id, kind: 'RENEWAL', status: 'PENDING_RENEWAL' } });
    return { orgMembershipId: m.id, processId: proc.id, leadEmail: lead.email! };
}

/** Applicant household + a lead + membership + a process at the given status. */
async function makeApplicant(status: 'PENDING_EXTERNAL_ACTION', extra: { lastBackgroundCheck?: Date } = {}) {
    const hh = await prisma.household.create({ data: { name: `Applicant ${TAG} ${Math.random()}` } });
    const lead = await prisma.person.create({
        data: { email: `lead-${Math.random()}-${TAG}@example.com`, name: 'Lead Parent', householdId: hh.id, lastBackgroundCheck: extra.lastBackgroundCheck ?? null },
    });
    await prisma.person.update({ where: { id: lead.id }, data: { isHouseholdLead: true } });
    const m = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'NONE' } });
    const proc = await prisma.orgMembershipProcess.create({ data: { orgMembershipId: m.id, kind: 'INITIAL', status } });
    return { householdId: hh.id, orgMembershipId: m.id, processId: proc.id, leadId: lead.id };
}

const statusOf = async (id: number) => (await prisma.orgMembershipProcess.findUnique({ where: { id } }))?.status;
const membershipStatusOf = async (id: number) => (await prisma.orgMembership.findUnique({ where: { id } }))?.status;

async function wipe() {
    const hhs = await prisma.household.findMany({
        where: { OR: [{ name: { contains: TAG } }, { householdMembers: { some: { email: { contains: TAG } } } }] },
        select: { id: true },
    });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        await prisma.backgroundCheckAttestation.deleteMany({ where: { process: { orgMembership: { householdId: { in: ids } } } } });
        await prisma.orgMembershipProcess.deleteMany({ where: { orgMembership: { householdId: { in: ids } } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.emergencyContact.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.person.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.volunteerDesignation.deleteMany({ where: { email: { contains: TAG } } });
}

const isVolunteerOf = async (id: number) => (await prisma.orgMembership.findUnique({ where: { id } }))?.isVolunteer;

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
        await makeBoardMember(); // recipient for the paid-reject refund alert
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
        const { processId, orgMembershipId, householdId, leadId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        // Pay first.
        await certifyPaymentPlan(processId, revA);
        expect(await statusOf(processId)).toBe('PENDING_BG_CLEARANCE');
        expect(await membershipStatusOf(orgMembershipId)).toBe('NONE'); // NOT active without a valid check

        // Review clears in parallel; the 2nd approval converges to ACTIVE.
        await attest(revA, processId, { result: 'APPROVE' });
        expect(await statusOf(processId)).toBe('PENDING_BG_CLEARANCE');
        await attest(revB, processId, { result: 'APPROVE' });
        expect(await statusOf(processId)).toBe('ACTIVE');
        expect(await membershipStatusOf(orgMembershipId)).toBe('ACTIVE');
        // Guardians' lastBackgroundCheck stamped.
        const lead = await prisma.person.findUnique({ where: { id: leadId } });
        expect(lead?.lastBackgroundCheck).not.toBeNull();
        expect(householdId).toBeGreaterThan(0);
    });

    it('check clears before payment → stays PENDING_PAYMENT, then paying activates', async () => {
        const { processId, orgMembershipId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        await attest(revA, processId, { result: 'APPROVE' });
        await attest(revB, processId, { result: 'APPROVE' });
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT'); // cleared, but unpaid → not active
        expect(await membershipStatusOf(orgMembershipId)).toBe('NONE');
        await certifyPaymentPlan(processId, revA);
        expect(await statusOf(processId)).toBe('ACTIVE');
        expect(await membershipStatusOf(orgMembershipId)).toBe('ACTIVE');
    });

    it('reject after payment → BLOCKED, membership stays inactive', async () => {
        const { processId, orgMembershipId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        await certifyPaymentPlan(processId, revA); // paid → PENDING_BG_CLEARANCE
        await attest(revA, processId, { result: 'REJECT' });
        expect(await statusOf(processId)).toBe('BLOCKED');
        expect(await membershipStatusOf(orgMembershipId)).toBe('NONE');
    });

    it('reject BEFORE the payment webhook → payment still recorded + board notified (no dropped money)', async () => {
        const { processId, orgMembershipId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);            // → PENDING_PAYMENT
        await attest(revA, processId, { result: 'APPROVE' });
        await attest(revB, processId, { result: 'REJECT' }); // → BLOCKED, not yet paid
        expect(await statusOf(processId)).toBe('BLOCKED');

        (sendEmail as jest.Mock).mockClear();
        await activate(processId, { via: 'payment', shopifyOrderId: 'late-pay' }); // webhook lands after the reject

        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('BLOCKED');                 // not resurrected
        expect(proc?.paidAt).not.toBeNull();                  // payment recorded, not dropped
        expect(proc?.shopifyOrderId).toBe('late-pay');
        expect(await membershipStatusOf(orgMembershipId)).toBe('NONE');
        expect(sendEmail as jest.Mock).toHaveBeenCalled();    // board alerted for refund

        // Webhook retry is idempotent: paidAt unchanged, no second alert.
        const firstPaidAt = proc?.paidAt?.getTime();
        (sendEmail as jest.Mock).mockClear();
        await activate(processId, { via: 'payment', shopifyOrderId: 'late-pay' });
        const proc2 = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc2?.paidAt?.getTime()).toBe(firstPaidAt);
        expect(sendEmail as jest.Mock).not.toHaveBeenCalled();
    });

    it('a still-valid prior check auto-clears at submit — no consent needed, pay activates directly', async () => {
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: 12 }, update: { bgRecheckMonths: 12 } });
        const { processId, orgMembershipId, householdId } = await makeApplicant('PENDING_EXTERNAL_ACTION', { lastBackgroundCheck: new Date() });
        // Reset the process to INTAKE with the household fully filled so submitIntake passes validation.
        await prisma.orgMembershipProcess.update({ where: { id: processId }, data: { status: 'INTAKE' } });
        await prisma.household.update({ where: { id: householdId }, data: { line1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701' } });
        await prisma.emergencyContact.create({ data: { householdId, name: 'Out Of House', phone: '555-555-1212', phoneDigits: '5555551212', priority: 0 } });
        const lead = await prisma.person.findFirst({ where: { householdId, isHouseholdLead: true } });

        await submitIntake(lead!.id);
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('PENDING_EXTERNAL_ACTION');
        expect(proc?.bgClearedAt).not.toBeNull(); // auto-validated

        // Contract alone advances (no BG consent needed), and paying activates immediately.
        await markContractSigned(processId);
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');
        await certifyPaymentPlan(processId, revA); // certifier must be outside the applicant household (conflict-of-interest guard)
        expect(await statusOf(processId)).toBe('ACTIVE');
        expect(await membershipStatusOf(orgMembershipId)).toBe('ACTIVE');
    });

    it('pre-designated volunteer family is flagged at PENDING_PAYMENT, before the check clears (#874)', async () => {
        const { processId, orgMembershipId, leadId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        const lead = await prisma.person.findUnique({ where: { id: leadId } });
        await prisma.volunteerDesignation.create({ data: { email: lead!.email! } });

        await markContractSigned(processId);
        await markBgConsent(processId, revA); // → PENDING_PAYMENT; review not yet started
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');
        // The dues tier is read at PENDING_PAYMENT (ensurePaymentLink) — the
        // allowlist must already be applied here, not only at clearance, or a
        // pay-first volunteer family is charged full dues.
        expect(await isVolunteerOf(orgMembershipId)).toBe(true);
    });

    it('fresh-check intake shortcut still matches the designation allowlist (#874)', async () => {
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: 12 }, update: { bgRecheckMonths: 12 } });
        const { processId, orgMembershipId, householdId, leadId } = await makeApplicant('PENDING_EXTERNAL_ACTION', { lastBackgroundCheck: new Date() });
        await prisma.orgMembershipProcess.update({ where: { id: processId }, data: { status: 'INTAKE' } });
        await prisma.household.update({ where: { id: householdId }, data: { line1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701' } });
        await prisma.emergencyContact.create({ data: { householdId, name: 'Out Of House', phone: '555-555-1212', phoneDigits: '5555551212', priority: 0 } });
        const lead = await prisma.person.findUnique({ where: { id: leadId } });
        await prisma.volunteerDesignation.create({ data: { email: lead!.email! } });

        await submitIntake(leadId);

        // clearBackgroundCheck never runs this cycle (auto-cleared), so the
        // shortcut itself must have applied the designation.
        expect(await isVolunteerOf(orgMembershipId)).toBe(true);
    });

    it('renewal with a still-valid background check matches a designation added since the last cycle (#874)', async () => {
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: 12 }, update: { bgRecheckMonths: 12 } });
        const { orgMembershipId, processId, leadEmail } = await makeFreshRenewal();
        await prisma.volunteerDesignation.create({ data: { email: leadEmail } });

        await beginRenewal(processId);
        expect(await statusOf(processId)).toBe('PENDING_EXTERNAL_ACTION');

        // The advance's PENDING_PAYMENT transition applies the allowlist — dues
        // are read at payment, which opens once the fresh agreement is signed.
        await markContractSigned(processId);
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');
        expect(await isVolunteerOf(orgMembershipId)).toBe(true);
    });

    it('an intake note holds payment at PENDING_BG_REVIEW until the review clears (#907)', async () => {
        const { processId, householdId, orgMembershipId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await prisma.household.update({ where: { id: householdId }, data: { intakeNotes: 'please treat us as a volunteer household' } });

        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        expect(await statusOf(processId)).toBe('PENDING_BG_REVIEW'); // held — not PENDING_PAYMENT

        // Payment is genuinely gated while held.
        await expect(certifyPaymentPlan(processId, revA)).rejects.toMatchObject({ code: 'wrong_phase' });

        // The reviewers (who are shown the note) clear the check → payment opens
        // with dues already settled by their volunteer mark.
        await attest(revA, processId, { result: 'APPROVE', isMarkedVolunteer: true });
        await attest(revB, processId, { result: 'APPROVE', isMarkedVolunteer: true });
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');
        expect(await isVolunteerOf(orgMembershipId)).toBe(true);
        await certifyPaymentPlan(processId, revA);
        expect(await statusOf(processId)).toBe('ACTIVE');
    });

    it('fresh check + intake note → no auto-clear at submit; the note goes through review (#907)', async () => {
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: 12 }, update: { bgRecheckMonths: 12 } });
        const { processId, householdId, leadId } = await makeApplicant('PENDING_EXTERNAL_ACTION', { lastBackgroundCheck: new Date() });
        await prisma.orgMembershipProcess.update({ where: { id: processId }, data: { status: 'INTAKE' } });
        await prisma.household.update({
            where: { id: householdId },
            data: { line1: '123 Test St', city: 'Austin', state: 'TX', postalCode: '78701', intakeNotes: 'volunteer only, no students' },
        });
        await prisma.emergencyContact.create({ data: { householdId, name: 'Out Of House', phone: '555-555-1212', phoneDigits: '5555551212', priority: 0 } });

        await submitIntake(leadId);
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('PENDING_EXTERNAL_ACTION');
        expect(proc?.bgClearedAt).toBeNull(); // shortcut disqualified by the note

        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        expect(await statusOf(processId)).toBe('PENDING_BG_REVIEW'); // held for the note
    });

    it('fresh-check renewal with a household note re-reviews instead of opening payment (#907)', async () => {
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: 12 }, update: { bgRecheckMonths: 12 } });
        const { orgMembershipId, processId } = await makeFreshRenewal();
        const m = await prisma.orgMembership.findUnique({ where: { id: orgMembershipId } });
        await prisma.household.update({ where: { id: m!.householdId }, data: { intakeNotes: 'note for the reviewer' } });

        await beginRenewal(processId);

        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        // Every renewal re-signs at the external step; the note disqualifies the
        // bgClearedAt shortcut for the still-valid background check (mirrors
        // submitIntake), so after sign + consent the advance holds at
        // PENDING_BG_REVIEW instead of opening payment.
        expect(proc?.status).toBe('PENDING_EXTERNAL_ACTION');
        expect(proc?.bgClearedAt).toBeNull(); // shortcut disqualified by the note

        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        expect(await statusOf(processId)).toBe('PENDING_BG_REVIEW'); // held for the note
    });

    it('conflict of interest: a certifier in the applicant household is blocked, sysadmin flag or not', async () => {
        const { processId, leadId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');

        // A household lead certifying their OWN membership = self-approval → forbidden.
        await expect(certifyPaymentPlan(processId, leadId)).rejects.toMatchObject({ code: 'forbidden' });
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT'); // unchanged — nothing certified

        // Promoting that same lead to sysadmin does not buy a way through: the guard
        // reads the household relationship, not the actor's roles.
        await prisma.person.update({ where: { id: leadId }, data: { isSysadmin: true } });
        await expect(certifyPaymentPlan(processId, leadId)).rejects.toMatchObject({ code: 'forbidden' });
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');
    });

    it('conflict of interest: overrideBlocked by the applicant household is blocked, sysadmin flag or not', async () => {
        const { processId, leadId } = await makeApplicant('PENDING_EXTERNAL_ACTION');
        await markContractSigned(processId);
        await markBgConsent(processId, revA);
        await attest(revA, processId, { result: 'REJECT' }); // one reject → BLOCKED
        expect(await statusOf(processId)).toBe('BLOCKED');

        // A household lead force-clearing their OWN blocked check = self-approval → forbidden.
        await expect(overrideBlocked(processId, leadId, 'approve')).rejects.toMatchObject({ code: 'same_household_applicant' });
        expect(await statusOf(processId)).toBe('BLOCKED'); // unchanged

        // A sysadmin is still the applicant's own household → still refused. This is the
        // asymmetry that mattered: attest() never let them vote on their own family's
        // check, so the stronger force-clear must not either.
        await prisma.person.update({ where: { id: leadId }, data: { isSysadmin: true } });
        await expect(overrideBlocked(processId, leadId, 'approve')).rejects.toMatchObject({ code: 'same_household_applicant' });
        expect(await statusOf(processId)).toBe('BLOCKED');
    });

    it('renewal with a still-valid background check: bgClearedAt stamped, signature opens payment, paying activates (not stuck)', async () => {
        await prisma.boardSettings.upsert({ where: { id: 1 }, create: { id: 1, bgRecheckMonths: 12 }, update: { bgRecheckMonths: 12 } });
        const { orgMembershipId, processId } = await makeFreshRenewal();
        await beginRenewal(processId);
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('PENDING_EXTERNAL_ACTION');
        expect(proc?.bgClearedAt).not.toBeNull(); // the bug: was null → paid renewal stuck forever
        await markContractSigned(processId);
        expect(await statusOf(processId)).toBe('PENDING_PAYMENT');
        await activate(processId, { via: 'payment', shopifyOrderId: 'renew-pay' });
        expect(await statusOf(processId)).toBe('ACTIVE');
        expect(await membershipStatusOf(orgMembershipId)).toBe('ACTIVE');
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
        const audits = await prisma.auditLog.findMany({ where: { tableName: 'OrgMembershipProcess', affectedEntityId: processId }, select: { newData: true } });
        const activations = audits.filter((a) => JSON.stringify(normalizeAuditData(a.newData)).includes('"status":"ACTIVE"')).length;
        expect(activations).toBe(1);
    });

    it('a stray payment for a process not awaiting payment is ignored (no state corruption)', async () => {
        const { processId } = await makeApplicant('PENDING_EXTERNAL_ACTION'); // no checkout link exists for this phase
        await activate(processId, { via: 'payment', shopifyOrderId: 'stray' });
        const proc = await prisma.orgMembershipProcess.findUnique({ where: { id: processId } });
        expect(proc?.status).toBe('PENDING_EXTERNAL_ACTION');
        expect(proc?.paidAt).toBeNull();
    });

    it('markContractSigned / markBgConsent on a non-existent process throw not_found', async () => {
        await expect(markContractSigned(999999999)).rejects.toMatchObject({ code: 'not_found' });
        await expect(markBgConsent(999999999, revA)).rejects.toMatchObject({ code: 'not_found' });
    });
});
