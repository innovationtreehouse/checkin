/**
 * @jest-environment node
 */
/**
 * Integration tests for runGroupSlackReconcile (spec §5.1, REVIEW ADDENDUM A2).
 * Real Postgres (INTEGRATION_DB=1) + stubbed global.fetch + partial config mock
 * (gotcha §11: this suite's module graph reaches config via apply.ts -> googleGroups.ts).
 *
 * Not yet wired to any cron/route (PR2) — these tests call runGroupSlackReconcile
 * directly.
 */

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { runGroupSlackReconcile } from "@/lib/sync/reconcile";
import { SLACK_REMOVAL_WARNING_MS } from "@/lib/sync/apply";
import { resetDirectoryTokenCache } from "@/lib/sync/googleGroups";

jest.mock("@/lib/email", () => ({ sendEmail: jest.fn().mockResolvedValue(true) }));

jest.mock("@/lib/config", () => {
    const actual = jest.requireActual("@/lib/config");
    return {
        __esModule: true,
        ...actual,
        config: {
            ...actual.config,
            googleDirectorySaKey: jest.fn(() => null),
            googleDirectoryAdminSubject: jest.fn(() => null),
            googleDirectoryConfigured: jest.fn(() => false),
        },
    };
});
import { config } from "@/lib/config";

const TAG = "sync-reconcile-test";
const now = new Date("2026-07-19T12:00:00.000Z");

const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
});
const FAKE_SA_KEY = JSON.stringify({ client_email: "x@example.com", private_key: privateKey });

function enableGoogle() {
    (config.googleDirectorySaKey as jest.Mock).mockReturnValue(FAKE_SA_KEY);
    (config.googleDirectoryAdminSubject as jest.Mock).mockReturnValue("admin@example.com");
    (config.googleDirectoryConfigured as jest.Mock).mockReturnValue(true);
}
function disableGoogle() {
    (config.googleDirectorySaKey as jest.Mock).mockReturnValue(null);
    (config.googleDirectoryAdminSubject as jest.Mock).mockReturnValue(null);
    (config.googleDirectoryConfigured as jest.Mock).mockReturnValue(false);
}
function jsonRes(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) };
}

let emailCounter = 0;
function uniqueEmail(label: string): string {
    emailCounter += 1;
    return `${TAG}-${label}-${emailCounter}@example.com`;
}
async function makeHousehold(name: string) {
    return prisma.household.create({ data: { name: `${TAG} ${name}` } });
}
async function makePerson(householdId: number) {
    return prisma.person.create({ data: { householdId, name: "Test Person", email: uniqueEmail("p") } });
}
async function makeProgram(opts: { googleGroupEmail?: string | null; slackChannelId?: string | null; endAt?: Date | null } = {}) {
    return prisma.program.create({
        data: { name: `${TAG} Program ${Math.random().toString(36).slice(2)}`, googleGroupEmail: opts.googleGroupEmail ?? null, slackChannelId: opts.slackChannelId ?? null, endAt: opts.endAt },
    });
}

async function wipe() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        const people = await prisma.person.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
        const personIds = people.map((p) => p.id);
        await prisma.syncState.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.auditLog.deleteMany({ where: { tableName: "SyncState" } });
        await prisma.programParticipant.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: ids } } });
        await prisma.person.deleteMany({ where: { id: { in: personIds } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.programSlackAuth.deleteMany({ where: { program: { name: { contains: TAG } } } });
    await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
}

describe("runGroupSlackReconcile", () => {
    let fetchMock: jest.Mock;
    const originalFetch = global.fetch;

    beforeEach(() => {
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
        jest.clearAllMocks();
        disableGoogle();
        resetDirectoryTokenCache(); // see apply.integration.test.ts's beforeEach for why
    });

    afterEach(async () => {
        global.fetch = originalFetch;
        await wipe();
    });

    it("adds a newly-desired person (google_group), audited, applied:true", async () => {
        enableGoogle();
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes("oauth2.googleapis.com")) return jsonRes(200, { access_token: "tok", expires_in: 3600 });
            return jsonRes(200, {});
        });

        const hh = await makeHousehold("add-hh");
        const person = await makePerson(hh.id);
        const program = await makeProgram({ googleGroupEmail: "grp@example.com" });
        await prisma.programParticipant.create({ data: { programId: program.id, personId: person.id, status: "ACTIVE" } });

        const summary = await runGroupSlackReconcile(now);
        expect(summary.desired).toBeGreaterThanOrEqual(1);
        expect(summary.added).toBeGreaterThanOrEqual(1);

        const row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "google_group" } });
        expect(row).toMatchObject({ desired: true, applied: true, error: null });
    });

    it("boundary removal: a program ending drops the participant from desired, google_group is removed IMMEDIATELY", async () => {
        enableGoogle();
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes("oauth2.googleapis.com")) return jsonRes(200, { access_token: "tok", expires_in: 3600 });
            return jsonRes(200, {});
        });

        const hh = await makeHousehold("boundary-hh");
        const person = await makePerson(hh.id);
        const program = await makeProgram({ googleGroupEmail: "grp@example.com" });
        await prisma.programParticipant.create({ data: { programId: program.id, personId: person.id, status: "ACTIVE" } });

        // First run: added.
        await runGroupSlackReconcile(now);
        let row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "google_group" } });
        expect(row?.applied).toBe(true);

        // Program ends -> no longer contributes to desired state -> boundary removal, immediate (no warning).
        await prisma.program.update({ where: { id: program.id }, data: { endAt: new Date(now.getTime() - 1000) } });
        const summary = await runGroupSlackReconcile(now);
        expect(summary.removed).toBeGreaterThanOrEqual(1);

        row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "google_group" } });
        expect(row).toMatchObject({ desired: false, applied: false }); // KEPT, not deleted
    });

    it("newsletter is never removed even after the person drops out of desired", async () => {
        let prevBoardSettings: { newsletterGoogleGroupEmail: string | null } | null = null;
        const existing = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        prevBoardSettings = existing ? { newsletterGoogleGroupEmail: existing.newsletterGoogleGroupEmail } : null;
        await prisma.boardSettings.upsert({
            where: { id: 1 },
            create: { id: 1, newsletterGoogleGroupEmail: "news@example.com" },
            update: { newsletterGoogleGroupEmail: "news@example.com" },
        });

        try {
            enableGoogle();
            fetchMock.mockImplementation(async (url: string) => {
                if (String(url).includes("oauth2.googleapis.com")) return jsonRes(200, { access_token: "tok", expires_in: 3600 });
                return jsonRes(200, {});
            });

            const hh = await makeHousehold("newsletter-hh");
            const person = await makePerson(hh.id);
            await prisma.orgMembership.create({ data: { householdId: hh.id, status: "ACTIVE" } });

            await runGroupSlackReconcile(now);
            let row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "newsletter" } });
            expect(row).toMatchObject({ desired: true, applied: true });

            // Membership revoked -> drops out of desired for google_group/members, but newsletter is add-only forever.
            await prisma.orgMembership.update({ where: { householdId: hh.id }, data: { status: "REVOKED" } });
            await runGroupSlackReconcile(now);

            row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "newsletter" } });
            expect(row).toMatchObject({ desired: true, applied: true }); // untouched
            await prisma.orgMembership.deleteMany({ where: { householdId: hh.id } });
        } finally {
            if (prevBoardSettings) await prisma.boardSettings.update({ where: { id: 1 }, data: prevBoardSettings });
            else await prisma.boardSettings.update({ where: { id: 1 }, data: { newsletterGoogleGroupEmail: null } });
        }
    });

    it("retries a previously-failed add on the next run", async () => {
        const hh = await makeHousehold("retry-hh");
        const person = await makePerson(hh.id);
        const program = await makeProgram({ googleGroupEmail: "grp@example.com" });
        await prisma.programParticipant.create({ data: { programId: program.id, personId: person.id, status: "ACTIVE" } });

        // First run: google unconfigured -> stays applied:false, lastAttemptAt untouched (integration off, not a failed attempt).
        const firstSummary = await runGroupSlackReconcile(now);
        expect(firstSummary.googleOff).toBe(true);
        let row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "google_group" } });
        expect(row?.applied).toBe(false);

        // Second run: google now configured but the external call fails -> applied stays false, error recorded.
        enableGoogle();
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes("oauth2.googleapis.com")) return jsonRes(200, { access_token: "tok", expires_in: 3600 });
            return jsonRes(500, { error: { message: "backend error" } });
        });
        await runGroupSlackReconcile(now);
        row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "google_group" } });
        expect(row?.applied).toBe(false);
        expect(row?.error).toContain("backend error");
        expect(row?.lastAttemptAt).not.toBeNull();

        // Third run: this is now a RETRY (lastAttemptAt was already set) — external call now succeeds.
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes("oauth2.googleapis.com")) return jsonRes(200, { access_token: "tok", expires_in: 3600 });
            return jsonRes(200, {});
        });
        const thirdSummary = await runGroupSlackReconcile(now);
        expect(thirdSummary.retried).toBeGreaterThanOrEqual(1);
        row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "google_group" } });
        expect(row?.applied).toBe(true);
    });

    it("slack removal is warn-then-remove: first lapse warns, re-enrollment before the 7-day kick clears the warning", async () => {
        const hh = await makeHousehold("slack-warn-hh");
        const person = await makePerson(hh.id);
        const program = await makeProgram({ slackChannelId: "C1" });
        await prisma.programSlackAuth.create({ data: { programId: program.id, botToken: "xoxb-test" } });
        await prisma.programParticipant.create({ data: { programId: program.id, personId: person.id, status: "ACTIVE" } });

        fetchMock.mockImplementation(async (url: string) => {
            const u = String(url);
            if (u.includes("users.lookupByEmail")) return jsonRes(200, { ok: true, user: { id: "U1" } });
            if (u.includes("conversations.invite")) return jsonRes(200, { ok: true });
            return jsonRes(200, { ok: true });
        });

        // Run 1: added to slack.
        await runGroupSlackReconcile(now);
        let row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "slack_channel" } });
        expect(row?.applied).toBe(true);

        // Enrollment ends -> lapses out of desired -> warn (not kicked) this run.
        await prisma.programParticipant.update({ where: { programId_personId: { programId: program.id, personId: person.id } }, data: { status: "PENDING" } });
        await runGroupSlackReconcile(now);
        row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "slack_channel" } });
        expect(row?.applied).toBe(true); // not kicked yet
        expect(row?.removalWarnedAt).not.toBeNull();
        expect(sendEmail).toHaveBeenCalled();

        // Re-enrolls before the 7-day kick -> the pending warning is cleared (A2 point 3).
        await prisma.programParticipant.update({ where: { programId_personId: { programId: program.id, personId: person.id } }, data: { status: "ACTIVE" } });
        await runGroupSlackReconcile(now);
        row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "slack_channel" } });
        expect(row?.desired).toBe(true);
        expect(row?.removalWarnedAt).toBeNull();
    });

    it("slack removal kicks 7+ days after the warning if still lapsed", async () => {
        const hh = await makeHousehold("slack-kick-hh");
        const person = await makePerson(hh.id);
        const program = await makeProgram({ slackChannelId: "C1" });
        await prisma.programSlackAuth.create({ data: { programId: program.id, botToken: "xoxb-test" } });

        // Seed the ledger directly: already applied, lapsed 7+ days ago (warned, never re-enrolled).
        await prisma.syncState.create({
            data: {
                personId: person.id, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`,
                desired: false, applied: true, removalWarnedAt: new Date(now.getTime() - SLACK_REMOVAL_WARNING_MS - 1000),
            },
        });
        fetchMock.mockImplementation(async (url: string) => {
            const u = String(url);
            if (u.includes("users.lookupByEmail")) return jsonRes(200, { ok: true, user: { id: "U1" } });
            if (u.includes("conversations.kick")) return jsonRes(200, { ok: true });
            return jsonRes(200, { ok: true });
        });

        const summary = await runGroupSlackReconcile(now);
        expect(summary.removed).toBeGreaterThanOrEqual(1);
        const row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "slack_channel" } });
        expect(row?.applied).toBe(false);
    });

    it("MAX_OPS budgets a run: excess pending removals are deferred, not all processed in one run", async () => {
        enableGoogle();
        fetchMock.mockImplementation(async (url: string) => {
            if (String(url).includes("oauth2.googleapis.com")) return jsonRes(200, { access_token: "tok", expires_in: 3600 });
            return jsonRes(200, {}); // every remove call "succeeds"
        });

        const hh = await makeHousehold("budget-hh");
        const person = await makePerson(hh.id);
        const TOTAL = 205; // > MAX_OPS (200)
        await prisma.syncState.createMany({
            data: Array.from({ length: TOTAL }, (_, i) => ({
                personId: person.id,
                targetKind: "google_group" as const,
                targetRef: `${TAG}-budget-grp-${i}@example.com`,
                scope: "org",
                desired: false,
                applied: true,
            })),
        });

        await runGroupSlackReconcile(now);

        const stillApplied = await prisma.syncState.count({ where: { personId: person.id, targetRef: { startsWith: `${TAG}-budget-grp-` }, applied: true } });
        const processed = await prisma.syncState.count({ where: { personId: person.id, targetRef: { startsWith: `${TAG}-budget-grp-` }, applied: false } });
        expect(processed).toBeLessThanOrEqual(200); // op budget respected
        expect(stillApplied).toBeGreaterThan(0); // some rows deferred to the next run
        expect(processed + stillApplied).toBe(TOTAL);
    });
});
