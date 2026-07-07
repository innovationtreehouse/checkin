/**
 * @jest-environment node
 */
/**
 * Integration tests for the escalating background-check NUDGE sweep
 * (runPersonBgNudgeSweep): an open PERSON_BG obligation nudges the student's
 * household with the Averity consent link, the ledger blocks a re-send at the same
 * threshold, escalation fires the next threshold, and cleared / submitted / under-18
 * subjects get nothing (eligibility mirrors person-bg-annual exactly).
 *
 * Modeled on personBgTriggers.integration.test.
 */
import { runPersonBgNudgeSweep } from '@/lib/membership/personBgNudge';
import prisma from '@/lib/prisma';

const CONSENT_URL = 'https://averity.example/consent-deep-link';

// No real emails; capture the fan-out. Provider mocked to a fixed deep link.
jest.mock('@/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/membership/background-check/manual-adapter', () => ({
    backgroundCheckProvider: { getConsentDeepLink: jest.fn().mockResolvedValue('https://averity.example/consent-deep-link') },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sendEmail } = require('@/lib/email') as { sendEmail: jest.Mock };

const TAG = 'person-bg-nudge-test';
const RECHECK_MONTHS = 12;
const BOUNDARY_SEED = new Date('2000-09-01');
const ADULT_DOB = new Date('1990-01-01');
const OPENED_AT = new Date('2026-06-01T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** A sweep time `days` after the obligation opened. */
function at(days: number) {
    return new Date(OPENED_AT.getTime() + days * DAY);
}

async function makeHousehold(slug: string) {
    return prisma.household.create({ data: { name: `${TAG} ${slug}` } });
}

async function makePerson(
    slug: string,
    householdId: number,
    data: Partial<{ dateOfBirth: Date | null; lastBackgroundCheck: Date | null; isHouseholdLead: boolean }> = {},
) {
    return prisma.person.create({
        data: {
            email: `${slug}-${TAG}@example.com`,
            name: slug,
            householdId,
            dateOfBirth: data.dateOfBirth ?? null,
            lastBackgroundCheck: data.lastBackgroundCheck ?? null,
            isHouseholdLead: data.isHouseholdLead ?? false,
        },
    });
}

async function attachToProgram(slug: string, personId: number) {
    const program = await prisma.program.create({ data: { name: `${TAG} ${slug} program` } });
    await prisma.programParticipant.create({ data: { programId: program.id, personId } });
}

/** Open a PERSON_BG obligation for a subject, with a controlled createdAt. */
async function openObligation(personId: number, createdAt: Date, extra: Partial<{ bgConsentAt: Date }> = {}) {
    return prisma.orgMembershipProcess.create({
        data: {
            kind: 'PERSON_BG',
            subjectPersonId: personId,
            orgMembershipId: null,
            status: 'PENDING_BG_REVIEW',
            createdAt,
            bgConsentAt: extra.bgConsentAt ?? null,
        },
    });
}

function emailsTo(addr: string) {
    return sendEmail.mock.calls.filter((c) => c[0] === addr);
}

function ledgerCount(processId: number) {
    return prisma.personBgNudge.count({ where: { processId } });
}

async function setRecheckMonths(months: number) {
    await prisma.boardSettings.upsert({
        where: { id: 1 },
        create: { id: 1, bgRecheckMonths: months, orgMembershipYearBoundary: BOUNDARY_SEED },
        update: { bgRecheckMonths: months, orgMembershipYearBoundary: BOUNDARY_SEED },
    });
}

async function cleanup() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    const progs = await prisma.program.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const progIds = progs.map((p) => p.id);
    if (ids.length || progIds.length) {
        const procs = await prisma.orgMembershipProcess.findMany({
            where: { subjectPerson: { householdId: { in: ids } } },
            select: { id: true },
        });
        const pids = procs.map((p) => p.id);
        await prisma.personBgNudge.deleteMany({ where: { processId: { in: pids } } });
        await prisma.programParticipant.deleteMany({ where: { programId: { in: progIds } } });
        await prisma.program.deleteMany({ where: { id: { in: progIds } } });
        await prisma.orgMembershipProcess.deleteMany({ where: { id: { in: pids } } });
        await prisma.person.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
}

describe('runPersonBgNudgeSweep — escalating nudges + dedup + eligibility', () => {
    let savedSettings: { bgRecheckMonths: number; orgMembershipYearBoundary: Date | null } | null = null;

    beforeAll(async () => {
        await cleanup();
        const prev = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        savedSettings = prev ? { bgRecheckMonths: prev.bgRecheckMonths, orgMembershipYearBoundary: prev.orgMembershipYearBoundary } : null;
        await setRecheckMonths(RECHECK_MONTHS);
    });

    afterAll(async () => {
        await cleanup();
        if (savedSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: savedSettings });
        await prisma.$disconnect();
    });

    beforeEach(() => sendEmail.mockClear());

    it('nudges the household (leads + student) with the consent + self-attest links, then dedups a re-run, then escalates', async () => {
        const hh = await makeHousehold('primary');
        const lead = await makePerson('lead', hh.id, { dateOfBirth: ADULT_DOB, isHouseholdLead: true });
        const student = await makePerson('student', hh.id, { dateOfBirth: ADULT_DOB });
        await attachToProgram('student', student.id);
        const proc = await openObligation(student.id, OPENED_AT);

        // Stage 0 (open): both the household lead and the student are emailed.
        const r0 = await runPersonBgNudgeSweep(at(0));
        expect(r0.nudged).toBeGreaterThanOrEqual(1);
        const studentEmails = emailsTo(student.email!);
        const leadEmails = emailsTo(lead.email!);
        expect(studentEmails).toHaveLength(1);
        expect(leadEmails).toHaveLength(1);
        // Email carries the Averity consent deep link + the self-attest path (#875 → /membership).
        const html = studentEmails[0][2] as string;
        expect(html).toContain(CONSENT_URL);
        expect(html).toContain('/membership');
        expect(await ledgerCount(proc.id)).toBe(1);

        // Dedup: same threshold on a re-run sends nothing new for this obligation.
        sendEmail.mockClear();
        await runPersonBgNudgeSweep(at(1));
        expect(emailsTo(student.email!)).toHaveLength(0);
        expect(await ledgerCount(proc.id)).toBe(1);

        // Escalation: day 14 crosses the next threshold → one more nudge, one more ledger row.
        sendEmail.mockClear();
        await runPersonBgNudgeSweep(at(14));
        expect(emailsTo(student.email!)).toHaveLength(1);
        expect(await ledgerCount(proc.id)).toBe(2);
    });

    it('a cleared subject gets nothing (verdict FRESH excludes them even before the obligation closes)', async () => {
        const hh = await makeHousehold('cleared');
        // Fresh check as of the sweep → personBgVerdict FRESH → excluded by the eligibility recheck.
        const student = await makePerson('cleared-student', hh.id, { dateOfBirth: ADULT_DOB, lastBackgroundCheck: new Date() });
        await attachToProgram('cleared-student', student.id);
        const proc = await openObligation(student.id, OPENED_AT);

        await runPersonBgNudgeSweep(at(0));
        expect(emailsTo(student.email!)).toHaveLength(0);
        expect(await ledgerCount(proc.id)).toBe(0);
    });

    it('a submitted obligation (bgConsentAt set) gets nothing — the student already did their part', async () => {
        const hh = await makeHousehold('submitted');
        const student = await makePerson('submitted-student', hh.id, { dateOfBirth: ADULT_DOB });
        await attachToProgram('submitted-student', student.id);
        const proc = await openObligation(student.id, OPENED_AT, { bgConsentAt: new Date() });

        await runPersonBgNudgeSweep(at(0));
        expect(emailsTo(student.email!)).toHaveLength(0);
        expect(await ledgerCount(proc.id)).toBe(0);
    });

    it('an under-18 subject gets nothing (verdict MINOR — mirrors person-bg-annual eligibility)', async () => {
        const hh = await makeHousehold('minor');
        const minor = await makePerson('minor-student', hh.id, { dateOfBirth: new Date('2015-01-01') });
        await attachToProgram('minor-student', minor.id);
        const proc = await openObligation(minor.id, OPENED_AT);

        await runPersonBgNudgeSweep(at(0));
        expect(emailsTo(minor.email!)).toHaveLength(0);
        expect(await ledgerCount(proc.id)).toBe(0);
    });

    it('no-op when bgRecheckMonths is unset (policy off)', async () => {
        const hh = await makeHousehold('nopolicy');
        const student = await makePerson('nopolicy-student', hh.id, { dateOfBirth: ADULT_DOB });
        await attachToProgram('nopolicy-student', student.id);
        const proc = await openObligation(student.id, OPENED_AT);

        await setRecheckMonths(0);
        const res = await runPersonBgNudgeSweep(at(0));
        expect(res).toMatchObject({ nudged: 0 });
        expect(emailsTo(student.email!)).toHaveLength(0);
        expect(await ledgerCount(proc.id)).toBe(0);
        await setRecheckMonths(RECHECK_MONTHS);
    });
});
