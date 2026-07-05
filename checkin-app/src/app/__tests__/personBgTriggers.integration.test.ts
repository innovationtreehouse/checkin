/**
 * @jest-environment node
 */
/**
 * Integration tests for Phase 2 PERSON_BG obligations: the two triggers that OPEN
 * the obligation (annual cohort + new-member activation), the subject-scoped
 * clear (stamps ONLY the subject person), and the two-reviewer gate keyed off the
 * SUBJECT's household. Warn-only — nothing blocks participation here.
 *
 * Modeled on renewalConcurrency / membershipReviewAPI / personBgComplianceAPI.
 */

import { runPersonBgAnnualSweep } from '@/lib/membership/personBgTriggers';
import { attest, ReviewError } from '@/lib/membership/review';
import { activate } from '@/lib/membership/payment';
import prisma from '@/lib/prisma';

// Congrats/reviewer pings must not hit Resend.
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

const TAG = 'person-bg-trigger-test';
const RECHECK_MONTHS = 12;
// Boundary anchored to Sept 1; nextBoundary() rolls it to the current/next year.
const BOUNDARY_SEED = new Date('2000-09-01');

/** Adult born long ago → ≥18 at any as-of date. */
const ADULT_DOB = new Date('1990-01-01');

async function makeHousehold(slug: string) {
    return prisma.household.create({ data: { name: `${TAG} ${slug}` } });
}

async function makePerson(slug: string, householdId: number, data: Partial<{ dateOfBirth: Date | null; lastBackgroundCheck: Date | null; isBackgroundCheckReviewer: boolean }> = {}) {
    return prisma.person.create({
        data: {
            email: `${slug}-${TAG}@example.com`,
            name: slug,
            householdId,
            dateOfBirth: data.dateOfBirth ?? null,
            lastBackgroundCheck: data.lastBackgroundCheck ?? null,
            isBackgroundCheckReviewer: data.isBackgroundCheckReviewer ?? false,
        },
    });
}

/** Attach a person to a fresh program as a participant so they count as program-attached. */
async function attachToProgram(slug: string, personId: number) {
    const program = await prisma.program.create({ data: { name: `${TAG} ${slug} program` } });
    await prisma.programParticipant.create({ data: { programId: program.id, personId } });
    return program.id;
}

function personBgCountFor(personId: number) {
    return prisma.orgMembershipProcess.count({ where: { kind: 'PERSON_BG', subjectPersonId: personId } });
}

async function cleanup() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    const progs = await prisma.program.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const progIds = progs.map((p) => p.id);
    if (ids.length || progIds.length) {
        const procs = await prisma.orgMembershipProcess.findMany({
            where: { OR: [{ orgMembership: { householdId: { in: ids } } }, { subjectPerson: { householdId: { in: ids } } }] },
            select: { id: true },
        });
        const pids = procs.map((p) => p.id);
        await prisma.backgroundCheckAttestation.deleteMany({ where: { processId: { in: pids } } });
        await prisma.programParticipant.deleteMany({ where: { programId: { in: progIds } } });
        await prisma.programVolunteer.deleteMany({ where: { programId: { in: progIds } } });
        await prisma.program.deleteMany({ where: { id: { in: progIds } } });
        await prisma.orgMembershipProcess.deleteMany({ where: { id: { in: pids } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.householdLead.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
}

async function setRecheckMonths(months: number) {
    await prisma.boardSettings.upsert({
        where: { id: 1 },
        create: { id: 1, bgRecheckMonths: months, orgMembershipYearBoundary: BOUNDARY_SEED },
        update: { bgRecheckMonths: months, orgMembershipYearBoundary: BOUNDARY_SEED },
    });
}

describe('PERSON_BG triggers + subject-scoped clear + gate', () => {
    let savedSettings: { bgRecheckMonths: number; orgMembershipYearBoundary: Date | null } | null = null;
    // Two distinct-household reviewers, both eligible (different households from any subject).
    let rev1 = 0, rev2 = 0;

    beforeAll(async () => {
        await cleanup();
        const prev = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        savedSettings = prev ? { bgRecheckMonths: prev.bgRecheckMonths, orgMembershipYearBoundary: prev.orgMembershipYearBoundary } : null;
        await setRecheckMonths(RECHECK_MONTHS);

        const hhA = await makeHousehold('revA');
        const hhB = await makeHousehold('revB');
        rev1 = (await makePerson('rev1', hhA.id, { isBackgroundCheckReviewer: true })).id;
        rev2 = (await makePerson('rev2', hhB.id, { isBackgroundCheckReviewer: true })).id;
    });

    afterAll(async () => {
        await cleanup();
        if (savedSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: savedSettings });
        await prisma.$disconnect();
    });

    it('Trigger A opens PERSON_BG only for ≥18-not-fresh program people, and re-running is idempotent', async () => {
        await setRecheckMonths(RECHECK_MONTHS);
        const hh = await makeHousehold('cohortA');
        const adult = await makePerson('cohort-adult', hh.id, { dateOfBirth: ADULT_DOB });
        // Turns 18 AFTER the Sept-1 boundary → 17 as of the boundary → MINOR, not opened.
        const notYet18 = await makePerson('cohort-notyet', hh.id, { dateOfBirth: new Date('2008-10-01') });
        const fresh = await makePerson('cohort-fresh', hh.id, { dateOfBirth: ADULT_DOB, lastBackgroundCheck: new Date() });
        for (const p of [adult, notYet18, fresh]) await attachToProgram(`cohort-${p.id}`, p.id);
        // Not program-attached → out of scope even though ≥18.
        const unattached = await makePerson('cohort-unattached', hh.id, { dateOfBirth: ADULT_DOB });

        await runPersonBgAnnualSweep(new Date());
        expect(await personBgCountFor(adult.id)).toBe(1);
        expect(await personBgCountFor(notYet18.id)).toBe(0);
        expect(await personBgCountFor(fresh.id)).toBe(0);
        expect(await personBgCountFor(unattached.id)).toBe(0);

        // Idempotent: after one full sweep, every NEEDED person already has one, so a
        // second sweep opens nothing new (globally, not just for our fixture).
        const rerun = await runPersonBgAnnualSweep(new Date());
        expect(rerun.opened).toBe(0);
        expect(await personBgCountFor(adult.id)).toBe(1);
    });

    it('Trigger A opens nothing when bgRecheckMonths <= 0 (policy unset)', async () => {
        const hh = await makeHousehold('nopolicy');
        const adult = await makePerson('nopolicy-adult', hh.id, { dateOfBirth: ADULT_DOB });
        await attachToProgram('nopolicy', adult.id);

        await setRecheckMonths(0);
        const res = await runPersonBgAnnualSweep(new Date());
        expect(res.opened).toBe(0);
        expect(await personBgCountFor(adult.id)).toBe(0);
        await setRecheckMonths(RECHECK_MONTHS); // restore for later tests
    });

    it('Trigger C opens on new-member activation for an already-18 joiner; an existing member taking a role mid-year opens nothing', async () => {
        // New member: household activates (INITIAL, bg already cleared, now paying) with
        // a program-attached adult member → Trigger C opens a PERSON_BG for that adult.
        const hh = await makeHousehold('joinerHh');
        const lead = await makePerson('joiner-lead', hh.id, { dateOfBirth: ADULT_DOB });
        await prisma.householdLead.create({ data: { householdId: hh.id, personId: lead.id } });
        const joiner = await makePerson('joiner-adult', hh.id, { dateOfBirth: ADULT_DOB });
        await attachToProgram('joiner', joiner.id);
        const membership = await prisma.orgMembership.create({ data: { householdId: hh.id, status: 'NONE' } });
        const proc = await prisma.orgMembershipProcess.create({
            data: { orgMembershipId: membership.id, kind: 'INITIAL', status: 'PENDING_PAYMENT', bgClearedAt: new Date() },
        });

        await activate(proc.id, { via: 'certified', actorId: lead.id });

        expect((await prisma.orgMembership.findUnique({ where: { id: membership.id } }))?.status).toBe('ACTIVE');
        expect(await personBgCountFor(joiner.id)).toBe(1); // Trigger C fired for the program adult

        // Negative: an EXISTING program member who turned 18 after the boundary. There is
        // no role-assignment trigger, and the annual run judges age as-of the boundary —
        // so nothing opens until the next annual run.
        const existingHh = await makeHousehold('existingHh');
        const roleTaker = await makePerson('role-taker', existingHh.id, { dateOfBirth: new Date('2008-10-01') });
        await attachToProgram('role-taker', roleTaker.id);
        await runPersonBgAnnualSweep(new Date());
        expect(await personBgCountFor(roleTaker.id)).toBe(0);
    });

    it('clearBackgroundCheck stamps ONLY the subject person — a household-mate is untouched', async () => {
        const hh = await makeHousehold('subjectHh');
        const subject = await makePerson('subject', hh.id, { dateOfBirth: ADULT_DOB });
        // A household-mate (also a lead) with no check — the old blanket-stamp would have
        // hit them; the subject-scoped clear must NOT.
        const mate = await makePerson('mate', hh.id, { dateOfBirth: ADULT_DOB });
        await prisma.householdLead.create({ data: { householdId: hh.id, personId: mate.id } });
        // The subject's household has NO OrgMembership (a program lead in a non-member
        // household) — the gate must still work off the subject's household.
        const proc = await prisma.orgMembershipProcess.create({
            data: { kind: 'PERSON_BG', subjectPersonId: subject.id, orgMembershipId: null, status: 'PENDING_BG_REVIEW' },
        });

        // First distinct reviewer: not enough (2 required) → still awaiting.
        await attest(rev1, proc.id, { result: 'APPROVE' });
        expect((await prisma.orgMembershipProcess.findUnique({ where: { id: proc.id } }))?.status).toBe('PENDING_BG_REVIEW');

        // Second distinct reviewer clears it.
        await attest(rev2, proc.id, { result: 'APPROVE' });
        const after = await prisma.orgMembershipProcess.findUnique({ where: { id: proc.id } });
        expect(after?.bgClearedAt).not.toBeNull();

        const s = await prisma.person.findUnique({ where: { id: subject.id } });
        const m = await prisma.person.findUnique({ where: { id: mate.id } });
        expect(s?.lastBackgroundCheck).not.toBeNull(); // subject stamped
        expect(m?.lastBackgroundCheck).toBeNull(); // household-mate untouched (the safety assertion)
    });

    it('gate: a reviewer in the SUBJECT household is rejected (same_household_applicant)', async () => {
        const hh = await makeHousehold('subjRevHh');
        const subject = await makePerson('subj-rev-subject', hh.id, { dateOfBirth: ADULT_DOB });
        const insider = await makePerson('subj-rev-insider', hh.id, { isBackgroundCheckReviewer: true });
        const proc = await prisma.orgMembershipProcess.create({
            data: { kind: 'PERSON_BG', subjectPersonId: subject.id, orgMembershipId: null, status: 'PENDING_BG_REVIEW' },
        });
        await expect(attest(insider.id, proc.id, { result: 'APPROVE' })).rejects.toMatchObject({
            code: 'same_household_applicant',
        } as Partial<ReviewError>);
    });

    it('gate: a REJECT moves the PERSON_BG to BLOCKED', async () => {
        const hh = await makeHousehold('rejectHh');
        const subject = await makePerson('reject-subject', hh.id, { dateOfBirth: ADULT_DOB });
        const proc = await prisma.orgMembershipProcess.create({
            data: { kind: 'PERSON_BG', subjectPersonId: subject.id, orgMembershipId: null, status: 'PENDING_BG_REVIEW' },
        });
        await attest(rev1, proc.id, { result: 'REJECT' });
        expect((await prisma.orgMembershipProcess.findUnique({ where: { id: proc.id } }))?.status).toBe('BLOCKED');
    });
});
