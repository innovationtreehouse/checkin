/**
 * @jest-environment node
 */
/**
 * Integration tests for computeDesiredState — the heart of the group-slack-sync
 * design (spec §4.3, REVIEW ADDENDUM A3/A4). Real Postgres (INTEGRATION_DB=1);
 * no external Google/Slack calls (desired.ts makes none).
 *
 * Covers:
 *  - A3 (13+ direct-sync threshold, stacking with the minor/lead-union rule)
 *  - A4 (program staff — lead mentor + core volunteers — synced under the same rule)
 *  - the youth reason-union (two minors -> lead keeps both tokens; drop one -> lead
 *    keeps the other)
 *  - program endAt boundary (past end -> contributes nothing)
 *  - LIVE_PERSON (a tombstoned participant is never synced)
 *  - members + newsletter (org scope, same add set, distinct targetKind)
 */

import prisma from "@/lib/prisma";
import { computeDesiredState, type DesiredEntry } from "@/lib/sync/desired";

const TAG = "sync-desired-test";
const now = new Date("2026-07-19T12:00:00.000Z");

function dobForAge(age: number): Date {
    return new Date(now.getFullYear() - age, now.getMonth(), now.getDate());
}

let emailCounter = 0;
function uniqueEmail(label: string): string {
    emailCounter += 1;
    return `${TAG}-${label}-${emailCounter}@example.com`;
}

async function makeHousehold(name: string) {
    return prisma.household.create({ data: { name: `${TAG} ${name}` } });
}

async function makePerson(householdId: number, opts: { age?: number; email?: string | null; isLead?: boolean; name?: string }) {
    return prisma.person.create({
        data: {
            householdId,
            name: opts.name ?? "Test Person",
            email: opts.email === undefined ? uniqueEmail("p") : opts.email,
            dateOfBirth: opts.age === undefined ? null : dobForAge(opts.age),
            isHouseholdLead: !!opts.isLead,
        },
    });
}

async function makeProgram(opts: { googleGroupEmail?: string | null; slackChannelId?: string | null; endAt?: Date | null; leadMentorId?: number | null }) {
    return prisma.program.create({
        data: {
            name: `${TAG} Program ${Math.random().toString(36).slice(2)}`,
            googleGroupEmail: opts.googleGroupEmail ?? null,
            slackChannelId: opts.slackChannelId ?? null,
            endAt: opts.endAt,
            leadMentorId: opts.leadMentorId ?? null,
        },
    });
}

function entriesFor(entries: DesiredEntry[], personId: number, targetKind: DesiredEntry["targetKind"]): DesiredEntry[] {
    return entries.filter((e) => e.personId === personId && e.targetKind === targetKind);
}

async function wipe() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        const people = await prisma.person.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
        const personIds = people.map((p) => p.id);
        await prisma.programParticipant.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.programVolunteer.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.person.deleteMany({ where: { id: { in: personIds } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
}

describe("computeDesiredState", () => {
    let prevBoardSettings: { membersGoogleGroupEmail: string | null; newsletterGoogleGroupEmail: string | null } | null = null;

    beforeAll(async () => {
        await wipe();
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevBoardSettings = existing
            ? { membersGoogleGroupEmail: existing.membersGoogleGroupEmail, newsletterGoogleGroupEmail: existing.newsletterGoogleGroupEmail }
            : null;
    });

    afterEach(async () => {
        await wipe();
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, membersGoogleGroupEmail: null, newsletterGoogleGroupEmail: null },
            update: { membersGoogleGroupEmail: null, newsletterGoogleGroupEmail: null },
        });
    });

    afterAll(async () => {
        if (prevBoardSettings) {
            await prisma.boardSettings.update({ where: { id: 1 }, data: prevBoardSettings });
        }
        await wipe();
    });

    describe("program participants (A3: age >= 13 direct-sync threshold)", () => {
        it("an adult participant with email is synced directly to both google_group and slack_channel", async () => {
            const hh = await makeHousehold("adult-hh");
            const adult = await makePerson(hh.id, { age: 30 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com", slackChannelId: "C111" });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: adult.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            const google = entriesFor(entries, adult.id, "google_group").find((e) => e.targetRef === "prog-group@example.com");
            const slack = entriesFor(entries, adult.id, "slack_channel").find((e) => e.targetRef === "C111");

            expect(google?.reasons).toContain(`own_enrollment:program:${program.id}`);
            expect(slack?.reasons).toContain(`own_enrollment:program:${program.id}`);
            expect(slack?.botTokenRef).toBe(program.id);
        });

        it("a minor under 13 is NOT direct-synced; their household lead is synced in their place", async () => {
            const hh = await makeHousehold("under13-hh");
            const lead = await makePerson(hh.id, { age: 40, isLead: true });
            const minor = await makePerson(hh.id, { age: 10 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com" });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: minor.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            expect(entriesFor(entries, minor.id, "google_group")).toHaveLength(0);
            const leadEntry = entriesFor(entries, lead.id, "google_group")[0];
            expect(leadEntry?.reasons).toContain(`minor_enrollment:program:${program.id}:person:${minor.id}`);
        });

        it("a 13-17 year old with email is direct-synced AND their household lead is also synced (stacks, A3)", async () => {
            const hh = await makeHousehold("teen-hh");
            const lead = await makePerson(hh.id, { age: 45, isLead: true });
            const teen = await makePerson(hh.id, { age: 15 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com" });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: teen.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            expect(entriesFor(entries, teen.id, "google_group")[0]?.reasons).toContain(`own_enrollment:program:${program.id}`);
            expect(entriesFor(entries, lead.id, "google_group")[0]?.reasons).toContain(`minor_enrollment:program:${program.id}:person:${teen.id}`);
        });

        it("a 13-17 year old with NO email is not direct-synced but still falls back to their lead", async () => {
            const hh = await makeHousehold("teen-noemail-hh");
            const lead = await makePerson(hh.id, { age: 45, isLead: true });
            const teen = await makePerson(hh.id, { age: 16, email: null });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com" });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: teen.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            expect(entriesFor(entries, teen.id, "google_group")).toHaveLength(0);
            expect(entriesFor(entries, lead.id, "google_group")[0]?.reasons).toContain(`minor_enrollment:program:${program.id}:person:${teen.id}`);
        });

        it("an adult with no email is dropped entirely (no lead fallback for non-minors)", async () => {
            const hh = await makeHousehold("noemail-adult-hh");
            const adult = await makePerson(hh.id, { age: 30, email: null });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com" });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: adult.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            expect(entries.filter((e) => e.personId === adult.id)).toHaveLength(0);
        });

        it("two minors under the same lead union their reasons; dropping one keeps the other (youth reason-union)", async () => {
            const hh = await makeHousehold("union-hh");
            const lead = await makePerson(hh.id, { age: 42, isLead: true });
            const minorA = await makePerson(hh.id, { age: 9 });
            const minorB = await makePerson(hh.id, { age: 8 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com" });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: minorA.id, status: "ACTIVE" } });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: minorB.id, status: "ACTIVE" } });

            const before = await computeDesiredState(now);
            const leadReasons = entriesFor(before, lead.id, "google_group")[0]?.reasons ?? [];
            expect(leadReasons).toContain(`minor_enrollment:program:${program.id}:person:${minorA.id}`);
            expect(leadReasons).toContain(`minor_enrollment:program:${program.id}:person:${minorB.id}`);

            // minorA's enrollment lapses (no longer ACTIVE) — the union recomputes live, no event bookkeeping.
            await prisma.programParticipant.update({ where: { programId_personId: { programId: program.id, personId: minorA.id } }, data: { status: "PENDING" } });

            const after = await computeDesiredState(now);
            const leadReasonsAfter = entriesFor(after, lead.id, "google_group")[0]?.reasons ?? [];
            expect(leadReasonsAfter).not.toContain(`minor_enrollment:program:${program.id}:person:${minorA.id}`);
            expect(leadReasonsAfter).toContain(`minor_enrollment:program:${program.id}:person:${minorB.id}`);
        });

        it("a program past its endAt boundary contributes nothing (boundary removal falls out of the diff)", async () => {
            const hh = await makeHousehold("ended-hh");
            const adult = await makePerson(hh.id, { age: 30 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com", endAt: new Date("2026-01-01T00:00:00.000Z") });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: adult.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            expect(entries.filter((e) => e.personId === adult.id)).toHaveLength(0);
        });

        it("a tombstoned (merged-away) participant is never synced (LIVE_PERSON)", async () => {
            const hh = await makeHousehold("tombstone-hh");
            const survivor = await makePerson(hh.id, { age: 30 });
            const tombstoned = await makePerson(hh.id, { age: 30 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com" });
            await prisma.programParticipant.create({ data: { programId: program.id, personId: tombstoned.id, status: "ACTIVE" } });
            await prisma.person.update({ where: { id: tombstoned.id }, data: { mergedIntoId: survivor.id } });

            const entries = await computeDesiredState(now);
            expect(entries.filter((e) => e.personId === tombstoned.id)).toHaveLength(0);
        });
    });

    describe("program staff (A4)", () => {
        it("the lead mentor is synced under a staff_lead reason", async () => {
            const hh = await makeHousehold("mentor-hh");
            const mentor = await makePerson(hh.id, { age: 35 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com", leadMentorId: mentor.id });

            const entries = await computeDesiredState(now);
            expect(entriesFor(entries, mentor.id, "google_group")[0]?.reasons).toContain(`staff_lead:program:${program.id}`);
        });

        it("a core ProgramVolunteer is synced under staff_corevol; a non-core volunteer is not", async () => {
            const hh = await makeHousehold("corevol-hh");
            const core = await makePerson(hh.id, { age: 35 });
            const nonCore = await makePerson(hh.id, { age: 35 });
            const program = await makeProgram({ googleGroupEmail: "prog-group@example.com" });
            await prisma.programVolunteer.create({ data: { programId: program.id, personId: core.id, isCore: true } });
            await prisma.programVolunteer.create({ data: { programId: program.id, personId: nonCore.id, isCore: false } });

            const entries = await computeDesiredState(now);
            expect(entriesFor(entries, core.id, "google_group")[0]?.reasons).toContain(`staff_corevol:program:${program.id}`);
            expect(entriesFor(entries, nonCore.id, "google_group")).toHaveLength(0);
        });
    });

    describe("members group + newsletter (org scope)", () => {
        async function setBoardGroups(members: string | null, newsletter: string | null) {
            await prisma.boardSettings.upsert({
                where: { id: 1 },
                create: { id: 1, membersGoogleGroupEmail: members, newsletterGoogleGroupEmail: newsletter },
                update: { membersGoogleGroupEmail: members, newsletterGoogleGroupEmail: newsletter },
            });
        }

        it("an ACTIVE household's adult member is synced to both members group and newsletter under own_membership", async () => {
            await setBoardGroups("members@example.com", "newsletter@example.com");
            const hh = await makeHousehold("member-hh");
            const adult = await makePerson(hh.id, { age: 40 });
            await prisma.orgMembership.create({ data: { householdId: hh.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            expect(entriesFor(entries, adult.id, "google_group")[0]?.reasons).toContain("own_membership");
            expect(entriesFor(entries, adult.id, "newsletter")[0]?.reasons).toContain("own_membership");
        });

        it("a minor in an ACTIVE household is not direct-synced; their lead is synced under minor_membership", async () => {
            await setBoardGroups("members@example.com", null);
            const hh = await makeHousehold("member-minor-hh");
            const lead = await makePerson(hh.id, { age: 40, isLead: true });
            const minor = await makePerson(hh.id, { age: 11 });
            await prisma.orgMembership.create({ data: { householdId: hh.id, status: "ACTIVE" } });

            const entries = await computeDesiredState(now);
            expect(entriesFor(entries, minor.id, "google_group")).toHaveLength(0);
            expect(entriesFor(entries, lead.id, "google_group")[0]?.reasons).toContain(`minor_membership:person:${minor.id}`);
        });

        it("a household with no ACTIVE org membership is excluded", async () => {
            await setBoardGroups("members@example.com", null);
            const hh = await makeHousehold("revoked-hh");
            const adult = await makePerson(hh.id, { age: 40 });
            await prisma.orgMembership.create({ data: { householdId: hh.id, status: "REVOKED" } });

            const entries = await computeDesiredState(now);
            expect(entries.filter((e) => e.personId === adult.id)).toHaveLength(0);
        });
    });
});
