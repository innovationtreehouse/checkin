/**
 * @jest-environment node
 */
/**
 * Integration tests for applyAdd / applyRemove / applySlackRemoval (spec §4.4,
 * REVIEW ADDENDUM A2/A6). Real Postgres (INTEGRATION_DB=1) + a stubbed global.fetch
 * (no real Google/Slack network calls) + a partial config mock (gotcha §11: this
 * suite's module graph reaches config.googleDirectorySaKey() via googleGroups.ts).
 */

import crypto from "crypto";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { applyAdd, applyRemove, applySlackRemoval, SLACK_REMOVAL_WARNING_MS } from "@/lib/sync/apply";
import { resetDirectoryTokenCache } from "@/lib/sync/googleGroups";
import type { DesiredEntry } from "@/lib/sync/desired";
import type { SyncState } from "@/generated/prisma/client";

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

const TAG = "sync-apply-test";
const now = new Date("2026-07-19T12:00:00.000Z");

const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
});
const FAKE_SA_KEY = JSON.stringify({ client_email: "test-sa@example.iam.gserviceaccount.com", private_key: privateKey });

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

function mockTokenExchange(fetchMock: jest.Mock) {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ access_token: "tok", expires_in: 3600 }) });
}
function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

async function makeHousehold(name: string) {
    return prisma.household.create({ data: { name: `${TAG} ${name}` } });
}
let emailCounter = 0;
function uniqueEmail(label: string): string {
    emailCounter += 1;
    return `${TAG}-${label}-${emailCounter}@example.com`;
}
async function makePerson(householdId: number, opts: { email?: string | null } = {}) {
    return prisma.person.create({
        data: { householdId, name: "Test Person", email: opts.email === undefined ? uniqueEmail("p") : opts.email },
    });
}
async function makeProgram(opts: { slackWorkspaceInviteUrl?: string | null } = {}) {
    return prisma.program.create({
        data: { name: `${TAG} Program ${Math.random().toString(36).slice(2)}`, slackWorkspaceInviteUrl: opts.slackWorkspaceInviteUrl ?? null },
    });
}

function makeEntry(overrides: Partial<DesiredEntry> & Pick<DesiredEntry, "personId" | "email" | "targetKind" | "targetRef" | "scope">): DesiredEntry {
    return { reasons: ["test_reason"], ...overrides };
}

async function wipe() {
    const hhs = await prisma.household.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
    const ids = hhs.map((h) => h.id);
    if (ids.length) {
        const people = await prisma.person.findMany({ where: { householdId: { in: ids } }, select: { id: true } });
        const personIds = people.map((p) => p.id);
        await prisma.syncState.deleteMany({ where: { personId: { in: personIds } } });
        await prisma.auditLog.deleteMany({ where: { tableName: "SyncState" } });
        await prisma.person.deleteMany({ where: { id: { in: personIds } } });
        await prisma.household.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.programSlackAuth.deleteMany({ where: { program: { name: { contains: TAG } } } });
    await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
}

describe("applyAdd / applyRemove / applySlackRemoval", () => {
    let fetchMock: jest.Mock;
    const originalFetch = global.fetch;

    beforeEach(() => {
        fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
        jest.clearAllMocks();
        disableGoogle(); // each test opts into enableGoogle() explicitly when it needs the client "on"
        // getGoogleDirectoryClient() reuses ONE module-level token cache across calls
        // (by design — one org-wide SA, no re-minting a JWT per external call within a
        // reconcile run). Reset it per test or a cached token from an earlier test
        // bypasses this test's queued token-exchange mock response entirely.
        resetDirectoryTokenCache();
    });

    afterEach(async () => {
        global.fetch = originalFetch;
        await wipe();
    });

    afterAll(async () => {
        await wipe();
    });

    describe("applyAdd — google_group", () => {
        it("leaves applied:false when Google Directory is unconfigured (integration off)", async () => {
            const hh = await makeHousehold("g-off");
            const person = await makePerson(hh.id);
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "google_group", targetRef: "grp@example.com", scope: "org" });

            const result = await applyAdd(entry, now, 0);
            expect(result.ok).toBe(false);
            const row = await prisma.syncState.findUnique({ where: { personId_targetKind_targetRef_scope: { personId: person.id, targetKind: "google_group", targetRef: "grp@example.com", scope: "org" } } });
            expect(row).toMatchObject({ desired: true, applied: false });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("on success: applied:true, error cleared, audit CREATE row written", async () => {
            enableGoogle();
            const hh = await makeHousehold("g-ok");
            const person = await makePerson(hh.id);
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "google_group", targetRef: "grp@example.com", scope: "org" });

            mockTokenExchange(fetchMock);
            fetchMock.mockResolvedValueOnce(jsonRes(200, { email: person.email }));

            const result = await applyAdd(entry, now, 0);
            expect(result.ok).toBe(true);
            const row = await prisma.syncState.findUnique({ where: { personId_targetKind_targetRef_scope: { personId: person.id, targetKind: "google_group", targetRef: "grp@example.com", scope: "org" } } });
            expect(row).toMatchObject({ applied: true, error: null });

            const audit = await prisma.auditLog.findFirst({ where: { tableName: "SyncState", affectedEntityId: row!.id, action: "CREATE" } });
            expect(audit).not.toBeNull();
        });

        it("on external failure: applied:false, error recorded", async () => {
            enableGoogle();
            const hh = await makeHousehold("g-fail");
            const person = await makePerson(hh.id);
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "google_group", targetRef: "grp@example.com", scope: "org" });

            mockTokenExchange(fetchMock);
            fetchMock.mockResolvedValueOnce(jsonRes(500, { error: { message: "backend error" } }));

            const result = await applyAdd(entry, now, 0);
            expect(result.ok).toBe(false);
            const row = await prisma.syncState.findUnique({ where: { personId_targetKind_targetRef_scope: { personId: person.id, targetKind: "google_group", targetRef: "grp@example.com", scope: "org" } } });
            expect(row?.applied).toBe(false);
            expect(row?.error).toContain("backend error");
        });

        it("a 409 on insert is tolerated as already-in-desired-state (applied:true)", async () => {
            enableGoogle();
            const hh = await makeHousehold("g-409");
            const person = await makePerson(hh.id);
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "google_group", targetRef: "grp@example.com", scope: "org" });

            mockTokenExchange(fetchMock);
            fetchMock.mockResolvedValueOnce(jsonRes(409, { error: { message: "Member already exists" } }));

            const result = await applyAdd(entry, now, 0);
            expect(result.ok).toBe(true);
        });
    });

    describe("applyAdd — slack_channel", () => {
        it("records 'no slack token' when the program has no ProgramSlackAuth row", async () => {
            const hh = await makeHousehold("s-notoken");
            const person = await makePerson(hh.id);
            const program = await makeProgram();
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`, botTokenRef: program.id });

            const result = await applyAdd(entry, now, 0);
            expect(result.ok).toBe(false);
            const row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "slack_channel" } });
            expect(row?.error).toBe("no slack token");
        });

        it("invite-link gap (R5): not-found-in-workspace sends the workspace invite email once, never resends", async () => {
            const hh = await makeHousehold("s-gap");
            const person = await makePerson(hh.id);
            const program = await makeProgram({ slackWorkspaceInviteUrl: "https://slack.example.com/invite" });
            await prisma.programSlackAuth.create({ data: { programId: program.id, botToken: "xoxb-test" } });
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`, botTokenRef: program.id });

            fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: false, error: "users_not_found" }));
            await applyAdd(entry, now, 0);
            expect(sendEmail).toHaveBeenCalledTimes(1);
            const row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "slack_channel" } });
            expect(row?.inviteEmailedAt).not.toBeNull();
            expect(row?.applied).toBe(false);

            // Second run: already emailed — no resend, even though still not found.
            fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: false, error: "users_not_found" }));
            await applyAdd(entry, now, 0);
            expect(sendEmail).toHaveBeenCalledTimes(1);
        });

        it("on success: lookup + invite, applied:true, audit CREATE row written", async () => {
            const hh = await makeHousehold("s-ok");
            const person = await makePerson(hh.id);
            const program = await makeProgram();
            await prisma.programSlackAuth.create({ data: { programId: program.id, botToken: "xoxb-test" } });
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`, botTokenRef: program.id });

            fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true, user: { id: "U123" } }));
            fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true }));

            const result = await applyAdd(entry, now, 0);
            expect(result.ok).toBe(true);
            const row = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "slack_channel" } });
            expect(row?.applied).toBe(true);
            const audit = await prisma.auditLog.findFirst({ where: { tableName: "SyncState", affectedEntityId: row!.id, action: "CREATE" } });
            expect(audit).not.toBeNull();
        });

        it("a 429 on invite surfaces retryAfterMs without throwing", async () => {
            const hh = await makeHousehold("s-429");
            const person = await makePerson(hh.id);
            const program = await makeProgram();
            await prisma.programSlackAuth.create({ data: { programId: program.id, botToken: "xoxb-test" } });
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`, botTokenRef: program.id });

            fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true, user: { id: "U123" } }));
            fetchMock.mockResolvedValueOnce(jsonRes(429, { ok: false, error: "ratelimited" }, { "retry-after": "30" }));

            const result = await applyAdd(entry, now, 0);
            expect(result.ok).toBe(false);
            expect(result.retryAfterMs).toBe(30_000);
        });
    });

    describe("applyRemove — google_group only", () => {
        it("returns ok:false as a no-op for non-google_group rows", async () => {
            const hh = await makeHousehold("rm-notgoogle");
            const person = await makePerson(hh.id);
            const row = await prisma.syncState.create({ data: { personId: person.id, targetKind: "newsletter", targetRef: "n@example.com", scope: "org", desired: false, applied: true } });

            const result = await applyRemove(row as SyncState, now, 0);
            expect(result.ok).toBe(false);
        });

        it("on success: applied:false, row KEPT (not deleted, A6), audit DELETE row written", async () => {
            enableGoogle();
            const hh = await makeHousehold("rm-ok");
            const person = await makePerson(hh.id);
            const row = await prisma.syncState.create({ data: { personId: person.id, targetKind: "google_group", targetRef: "grp@example.com", scope: "org", desired: false, applied: true } });

            mockTokenExchange(fetchMock);
            fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

            const result = await applyRemove(row as SyncState, now, 0);
            expect(result.ok).toBe(true);
            const after = await prisma.syncState.findUnique({ where: { id: row.id } });
            expect(after).not.toBeNull(); // kept, not deleted
            expect(after?.applied).toBe(false);
            const audit = await prisma.auditLog.findFirst({ where: { tableName: "SyncState", affectedEntityId: row.id, action: "DELETE" } });
            expect(audit).not.toBeNull();
        });

        it("a 404 on remove is tolerated as already-in-desired-state", async () => {
            enableGoogle();
            const hh = await makeHousehold("rm-404");
            const person = await makePerson(hh.id);
            const row = await prisma.syncState.create({ data: { personId: person.id, targetKind: "google_group", targetRef: "grp@example.com", scope: "org", desired: false, applied: true } });

            mockTokenExchange(fetchMock);
            fetchMock.mockResolvedValueOnce(jsonRes(404, {}));

            const result = await applyRemove(row as SyncState, now, 0);
            expect(result.ok).toBe(true);
        });
    });

    describe("applySlackRemoval — warn-then-remove (A2)", () => {
        it("first call sends the warning email and sets removalWarnedAt; no kick yet", async () => {
            const hh = await makeHousehold("warn-1");
            const person = await makePerson(hh.id);
            const program = await makeProgram();
            const row = await prisma.syncState.create({ data: { personId: person.id, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`, desired: false, applied: true } });

            const result = await applySlackRemoval(row as SyncState, now, 0);
            expect(result).toEqual({ warned: true, removed: false });
            expect(sendEmail).toHaveBeenCalledTimes(1);
            const after = await prisma.syncState.findUnique({ where: { id: row.id } });
            expect(after?.removalWarnedAt).not.toBeNull();
            expect(after?.applied).toBe(true); // unchanged — not kicked
            expect(fetchMock).not.toHaveBeenCalled(); // no Slack call on the warn step
        });

        it("a second call within the 7-day grace window is a no-op", async () => {
            const hh = await makeHousehold("warn-2");
            const person = await makePerson(hh.id);
            const program = await makeProgram();
            const row = await prisma.syncState.create({ data: { personId: person.id, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`, desired: false, applied: true, removalWarnedAt: now } });

            const soon = new Date(now.getTime() + 1000);
            const result = await applySlackRemoval(row as SyncState, soon, 0);
            expect(result).toEqual({ warned: false, removed: false });
            const after = await prisma.syncState.findUnique({ where: { id: row.id } });
            expect(after?.applied).toBe(true);
            expect(after?.removalWarnedAt?.getTime()).toBe(now.getTime()); // unchanged
        });

        it("a call 7+ days after the warning kicks the user out (removeFromChannel), applied:false, audit DELETE", async () => {
            const hh = await makeHousehold("warn-3");
            const person = await makePerson(hh.id);
            const program = await makeProgram();
            await prisma.programSlackAuth.create({ data: { programId: program.id, botToken: "xoxb-test" } });
            const row = await prisma.syncState.create({ data: { personId: person.id, targetKind: "slack_channel", targetRef: "C1", scope: `program:${program.id}`, desired: false, applied: true, removalWarnedAt: now } });

            fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true, user: { id: "U1" } })); // lookupByEmail
            fetchMock.mockResolvedValueOnce(jsonRes(200, { ok: true })); // conversations.kick

            const later = new Date(now.getTime() + SLACK_REMOVAL_WARNING_MS + 1000);
            const result = await applySlackRemoval(row as SyncState, later, 0);
            expect(result).toEqual({ warned: false, removed: true });
            const after = await prisma.syncState.findUnique({ where: { id: row.id } });
            expect(after?.applied).toBe(false);
            const audit = await prisma.auditLog.findFirst({ where: { tableName: "SyncState", affectedEntityId: row.id, action: "DELETE" } });
            expect(audit).not.toBeNull();
        });
    });

    describe("A2 point 3 — re-desiring clears a pending removal warning", () => {
        it("applyAdd on a row with removalWarnedAt set clears it (re-enrollment cancels the pending removal)", async () => {
            enableGoogle();
            const hh = await makeHousehold("clear-warn");
            const person = await makePerson(hh.id);
            const program = await makeProgram();
            await prisma.syncState.create({ data: { personId: person.id, targetKind: "google_group", targetRef: "grp@example.com", scope: `program:${program.id}`, desired: false, applied: true, removalWarnedAt: now } });

            mockTokenExchange(fetchMock);
            fetchMock.mockResolvedValueOnce(jsonRes(200, {}));
            const entry = makeEntry({ personId: person.id, email: person.email!, targetKind: "google_group", targetRef: "grp@example.com", scope: `program:${program.id}` });
            await applyAdd(entry, now, 0);

            const after = await prisma.syncState.findFirst({ where: { personId: person.id, targetKind: "google_group" } });
            expect(after?.removalWarnedAt).toBeNull();
            expect(after?.desired).toBe(true);
        });
    });
});
