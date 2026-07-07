/**
 * @jest-environment node
 */
/**
 * Integration tests for the program → Google Group feature against a real DB:
 *  1. Config save — PATCH /api/programs/[id] persists (normalizes) a valid
 *     googleGroupEmail and rejects a malformed one.
 *  2. A sync run — POST /api/programs/[id]/sync-google-group reconciles the
 *     group against the ACTIVE roster, with the Google Directory API stubbed via
 *     a mocked global.fetch (token → list → add/remove).
 *
 * Real service-account creds aren't used: GOOGLE_SA_KEY_JSON holds a locally
 * generated RSA key just so the JWT-bearer assertion signs, and every HTTP call
 * is intercepted. Mirrors programSyncShopifyAPI.integration.test.ts.
 */
import crypto from "crypto";
import { PATCH } from "@/app/api/programs/[id]/route";
import { POST as SYNC } from "@/app/api/programs/[id]/sync-google-group/route";
import { resetTokenCache } from "@/lib/googleGroups";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));

const TAG = "google-group-sync-test";
const GROUP = `${TAG}-group@example.org`;
const params = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) }) as unknown as never;
const patchReq = (body: unknown) =>
    new Request("http://localhost/api/programs/x", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: "session=test" },
        body: JSON.stringify(body),
    }) as unknown as import("next/server").NextRequest;
const syncReq = () =>
    new Request("http://localhost/api/programs/x/sync-google-group", { method: "POST", headers: { cookie: "session=test" } }) as unknown as import("next/server").NextRequest;

const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

describe("program Google Group sync", () => {
    let boardId: number;
    let leadId: number;
    let kidId: number;
    let programId: number;
    let savedEnv: Record<string, string | undefined>;
    let savedFetch: typeof global.fetch;

    beforeAll(async () => {
        savedEnv = { KEY: process.env.GOOGLE_SA_KEY_JSON, SUB: process.env.GOOGLE_SA_SUBJECT };
        process.env.GOOGLE_SA_KEY_JSON = JSON.stringify({ client_email: "sa@proj.iam.gserviceaccount.com", private_key: privateKey });
        process.env.GOOGLE_SA_SUBJECT = "admin@example.org";
        savedFetch = global.fetch;

        const board = await prisma.person.create({
            data: { email: `board-${TAG}@example.com`, name: "Board", isBoardMember: true, household: { create: { name: "Board HH" } } },
        });
        boardId = board.id;

        // One household: a lead (with email) + a dependent kid (with email).
        const lead = await prisma.person.create({
            data: { email: `lead-${TAG}@example.org`, name: "Lead", isHouseholdLead: true, household: { create: { name: `HH ${TAG}` } } },
        });
        leadId = lead.id;
        const kid = await prisma.person.create({
            data: { email: `kid-${TAG}@example.org`, name: "Kid", householdId: lead.householdId },
        });
        kidId = kid.id;

        const program = await prisma.program.create({ data: { name: `Prog ${TAG}`, phase: "RUNNING", googleGroupEmail: GROUP } });
        programId = program.id;
        await prisma.programParticipant.create({ data: { programId, personId: kidId, status: "ACTIVE" } });
    });

    afterAll(async () => {
        const ids = [boardId, leadId, kidId];
        await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { secondaryAffectedEntity: programId }] } });
        await prisma.programParticipant.deleteMany({ where: { programId } });
        await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.person.deleteMany({ where: { id: { in: ids } } });
        await prisma.household.deleteMany({ where: { name: { contains: TAG } } });
        if (savedEnv.KEY === undefined) delete process.env.GOOGLE_SA_KEY_JSON; else process.env.GOOGLE_SA_KEY_JSON = savedEnv.KEY;
        if (savedEnv.SUB === undefined) delete process.env.GOOGLE_SA_SUBJECT; else process.env.GOOGLE_SA_SUBJECT = savedEnv.SUB;
        global.fetch = savedFetch;
    });

    beforeEach(() => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
        resetTokenCache();
    });

    describe("config save (PATCH /api/programs/[id])", () => {
        it("persists a valid group email, normalized to lowercase/trimmed", async () => {
            const res = await PATCH(patchReq({ googleGroupEmail: `  NEW-${TAG}@Example.ORG ` }), params(programId));
            expect(res.status).toBe(200);
            const persisted = await prisma.program.findUnique({ where: { id: programId } });
            expect(persisted?.googleGroupEmail).toBe(`new-${TAG}@example.org`);
            // restore for the sync test
            await prisma.program.update({ where: { id: programId }, data: { googleGroupEmail: GROUP } });
        });

        it("rejects a malformed email (400) and does not change the stored value", async () => {
            const res = await PATCH(patchReq({ googleGroupEmail: "not-an-email" }), params(programId));
            expect(res.status).toBe(400);
            const persisted = await prisma.program.findUnique({ where: { id: programId } });
            expect(persisted?.googleGroupEmail).toBe(GROUP);
        });

        it("clears the group when given an empty string", async () => {
            const res = await PATCH(patchReq({ googleGroupEmail: "" }), params(programId));
            expect(res.status).toBe(200);
            const persisted = await prisma.program.findUnique({ where: { id: programId } });
            expect(persisted?.googleGroupEmail).toBeNull();
            await prisma.program.update({ where: { id: programId }, data: { googleGroupEmail: GROUP } });
        });
    });

    describe("sync run (POST /api/programs/[id]/sync-google-group)", () => {
        it("reconciles the group: adds the ACTIVE roster (self + lead), removes a stale MEMBER", async () => {
            const calls: { method: string; url: string }[] = [];
            global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
                const u = String(url);
                const method = init?.method ?? "GET";
                calls.push({ method, url: u });
                if (u.includes("oauth2.googleapis.com/token")) {
                    return { ok: true, status: 200, json: async () => ({ access_token: "tok", expires_in: 3599 }) } as Response;
                }
                if (u.includes("/members") && method === "GET") {
                    // Current group: one stale MEMBER that isn't on the roster.
                    return { ok: true, status: 200, json: async () => ({ members: [{ email: `stale-${TAG}@example.org`, role: "MEMBER" }] }) } as Response;
                }
                // add (POST) / remove (DELETE)
                return { ok: true, status: 200, json: async () => ({}), text: async () => "" } as Response;
            }) as unknown as typeof global.fetch;

            const res = await SYNC(syncReq(), params(programId));
            expect(res.status).toBe(200);
            const data = await res.json();
            // desired = kid + lead (2 adds), stale removed (1).
            expect(data).toEqual({ success: true, added: 2, removed: 1 });

            const posts = calls.filter((c) => c.method === "POST" && c.url.includes("/members"));
            const deletes = calls.filter((c) => c.method === "DELETE");
            expect(posts).toHaveLength(2);
            expect(deletes).toHaveLength(1);
            expect(deletes[0].url).toContain(encodeURIComponent(`stale-${TAG}@example.org`));
        });

        it("returns 400 when the program has no group configured", async () => {
            await prisma.program.update({ where: { id: programId }, data: { googleGroupEmail: null } });
            const res = await SYNC(syncReq(), params(programId));
            expect(res.status).toBe(400);
            await prisma.program.update({ where: { id: programId }, data: { googleGroupEmail: GROUP } });
        });
    });
});
