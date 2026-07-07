/**
 * Unit tests for the shared program → Google Group sync service
 * (lib/program/groupSync.ts). Prisma, the Google client, and logIntegrationError
 * are mocked, so this pins the RECIPIENT RULE (self + household leads), the
 * removal safety net (shared lead stays), the reconcile diff (add missing /
 * remove MEMBER-only), and the BEST-EFFORT contract (a Google failure on the push
 * paths never throws — it must not fail the enrollment/withdrawal that triggered it).
 */
import {
    resolveGroupEmails,
    pushGroupAddOnActivation,
    pushGroupRemoveOnWithdrawal,
    reconcileProgramGroup,
} from "../groupSync";

jest.mock("@/lib/prisma", () => ({
    __esModule: true,
    default: {
        person: { findUnique: jest.fn() },
        programParticipant: { findMany: jest.fn() },
    },
}));

jest.mock("@/lib/googleGroups", () => ({
    addGroupMember: jest.fn().mockResolvedValue(undefined),
    removeGroupMember: jest.fn().mockResolvedValue(undefined),
    listGroupMembers: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    logIntegrationError: jest.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prisma = require("@/lib/prisma").default;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { addGroupMember, removeGroupMember, listGroupMembers } = require("@/lib/googleGroups");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { logIntegrationError } = require("@/lib/logger");

const GROUP = "prog@example.org";
const program = { id: 7, googleGroupEmail: GROUP };

/** person.findUnique row shape: self email + household-lead emails. */
function person(email: string | null, leadEmails: string[]) {
    return { email, household: { householdMembers: leadEmails.map((e) => ({ email: e })) } };
}

let originalEnv: NodeJS.ProcessEnv;
beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GOOGLE_SA_KEY_JSON = "{}";
    process.env.GOOGLE_SA_SUBJECT = "admin@example.org";
    jest.clearAllMocks();
});
afterEach(() => {
    process.env = originalEnv;
});

describe("resolveGroupEmails — recipient rule (self + household leads)", () => {
    it("returns self + lead emails, deduped and lowercased", async () => {
        prisma.person.findUnique.mockResolvedValue(person("Kid@Example.org", ["Lead@Example.org", "kid@example.org"]));
        const emails = await resolveGroupEmails(1);
        expect(emails.sort()).toEqual(["kid@example.org", "lead@example.org"]);
    });

    it("a dependent with no email is represented by the household lead(s)", async () => {
        prisma.person.findUnique.mockResolvedValue(person(null, ["lead@example.org"]));
        expect(await resolveGroupEmails(1)).toEqual(["lead@example.org"]);
    });

    it("empty when the person is gone", async () => {
        prisma.person.findUnique.mockResolvedValue(null);
        expect(await resolveGroupEmails(1)).toEqual([]);
    });
});

describe("pushGroupAddOnActivation", () => {
    it("adds each resolved email to the group", async () => {
        prisma.person.findUnique.mockResolvedValue(person("kid@example.org", ["lead@example.org"]));
        await pushGroupAddOnActivation(program, 1);
        expect(addGroupMember).toHaveBeenCalledTimes(2);
        expect(addGroupMember).toHaveBeenCalledWith(GROUP, "kid@example.org");
        expect(addGroupMember).toHaveBeenCalledWith(GROUP, "lead@example.org");
    });

    it("no-ops when the program has no group", async () => {
        await pushGroupAddOnActivation({ id: 7, googleGroupEmail: null }, 1);
        expect(prisma.person.findUnique).not.toHaveBeenCalled();
        expect(addGroupMember).not.toHaveBeenCalled();
    });

    it("no-ops when the integration is unconfigured", async () => {
        delete process.env.GOOGLE_SA_KEY_JSON;
        await pushGroupAddOnActivation(program, 1);
        expect(addGroupMember).not.toHaveBeenCalled();
    });

    it("BEST-EFFORT: never throws when Google fails — logs to Link Status instead", async () => {
        prisma.person.findUnique.mockResolvedValue(person("kid@example.org", []));
        addGroupMember.mockRejectedValueOnce(new Error("Google 500"));
        await expect(pushGroupAddOnActivation(program, 1)).resolves.toBeUndefined();
        expect(logIntegrationError).toHaveBeenCalledWith("google-groups", expect.any(Error), expect.objectContaining({ operation: "add", programId: 7, personId: 1 }));
    });
});

describe("pushGroupRemoveOnWithdrawal", () => {
    it("removes only the leaving person's emails NOT still needed by the remaining roster", async () => {
        // Leaving kid contributed self + a shared household lead.
        prisma.person.findUnique.mockResolvedValue(person("kid1@example.org", ["lead@example.org"]));
        // Remaining ACTIVE roster still includes a sibling under the same lead.
        prisma.programParticipant.findMany.mockResolvedValue([
            { person: person("kid2@example.org", ["lead@example.org"]) },
        ]);

        await pushGroupRemoveOnWithdrawal(program, 1);

        // kid1's own address goes; the shared lead stays (sibling still needs it).
        expect(removeGroupMember).toHaveBeenCalledTimes(1);
        expect(removeGroupMember).toHaveBeenCalledWith(GROUP, "kid1@example.org");
    });

    it("BEST-EFFORT: never throws when Google fails", async () => {
        prisma.person.findUnique.mockResolvedValue(person("kid1@example.org", []));
        prisma.programParticipant.findMany.mockResolvedValue([]);
        removeGroupMember.mockRejectedValueOnce(new Error("Google 500"));
        await expect(pushGroupRemoveOnWithdrawal(program, 1)).resolves.toBeUndefined();
        expect(logIntegrationError).toHaveBeenCalledWith("google-groups", expect.any(Error), expect.objectContaining({ operation: "remove" }));
    });
});

describe("reconcileProgramGroup — full diff", () => {
    it("adds missing desired members and removes MEMBER-role extras, keeping OWNER/MANAGER", async () => {
        prisma.programParticipant.findMany.mockResolvedValue([
            { person: person("keep@example.org", []) },
            { person: person("new@example.org", []) },
        ]);
        listGroupMembers.mockResolvedValue([
            { email: "keep@example.org", role: "MEMBER" }, // desired + present → left alone
            { email: "stale@example.org", role: "MEMBER" }, // not desired → removed
            { email: "owner@example.org", role: "OWNER" }, // not desired but OWNER → kept
        ]);

        const result = await reconcileProgramGroup(program);

        expect(result).toEqual({ added: 1, removed: 1 });
        expect(addGroupMember).toHaveBeenCalledWith(GROUP, "new@example.org");
        expect(removeGroupMember).toHaveBeenCalledWith(GROUP, "stale@example.org");
        expect(removeGroupMember).not.toHaveBeenCalledWith(GROUP, "owner@example.org");
    });

    it("skips cleanly when unconfigured", async () => {
        delete process.env.GOOGLE_SA_SUBJECT;
        expect(await reconcileProgramGroup(program)).toEqual({ skipped: "integration not configured" });
        expect(listGroupMembers).not.toHaveBeenCalled();
    });
});
