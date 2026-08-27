/**
 * @jest-environment node
 *
 * Unit tests (mocked prisma) for the parked-scan review surface (
 * KIOSK_RESILIENCE §2 D7): the list's filter, both routes' role admission, and
 * that the dismiss stamps reviewedAt AND reviewedBy and nothing else.
 *
 * The filter is the whole feature — `reviewReason != null AND reviewedAt = null`
 * IS the queue definition, so it is asserted against the query, not inferred
 * from a fixture that happens to come back.
 */
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { GET } from "../route";
import { POST } from "../[id]/route";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-options", () => ({ authOptions: {} }));
jest.mock("@/lib/verify-kiosk", () => ({
    getKioskPublicKeys: jest.fn().mockReturnValue([]),
    verifyKioskSignature: jest.fn().mockReturnValue({ ok: false }),
}));
// The jest.fn()s are created INSIDE the factory and read back off the mocked
// module: a factory closing over an outer `const` hits its TDZ, since the route
// import (hoisted) loads prisma before this module body runs.
jest.mock("@/lib/prisma", () => ({
    __esModule: true,
    default: { rawBadgeLog: { findMany: jest.fn(), updateMany: jest.fn() } },
}));

const db = prisma as unknown as { rawBadgeLog: { findMany: jest.Mock; updateMany: jest.Mock } };
const mockSession = getServerSession as jest.Mock;
const SYSADMIN = { user: { id: 99, isSysadmin: true, isBoardMember: false } };
const BOARD = { user: { id: 42, isSysadmin: false, isBoardMember: true } };
const KEYHOLDER = { user: { id: 8, isSysadmin: false, isBoardMember: false, isKeyholder: true } };
const OPERATIONS = { user: { id: 9, isSysadmin: false, isBoardMember: false, isOperations: true } };
const MEMBER = { user: { id: 7, isSysadmin: false, isBoardMember: false } };

const parkedRow = {
    id: 5,
    personId: 12,
    timestamp: new Date("2026-08-20T19:14:00.000Z"),
    location: "Main Entrance",
    clientEventId: "evt-stale",
    reviewReason: "stale_replay",
    person: { id: 12, name: "Ada Lovelace" },
};

const listReq = () =>
    new Request("http://localhost/api/system-status/unsynced-scans") as unknown as import("next/server").NextRequest;
const dismissReq = () =>
    new Request("http://localhost/api/system-status/unsynced-scans/5", {
        method: "POST",
    }) as unknown as import("next/server").NextRequest;
const dismissCtx = (id = "5") => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue(SYSADMIN);
    db.rawBadgeLog.findMany.mockResolvedValue([parkedRow]);
    db.rawBadgeLog.updateMany.mockResolvedValue({ count: 1 });
});

describe("GET /api/system-status/unsynced-scans", () => {
    it("lists only rows that parked and have not been reviewed, newest first, capped at 100", async () => {
        const res = await GET(listReq());
        expect(res.status).toBe(200);

        expect(db.rawBadgeLog.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { reviewReason: { not: null }, reviewedAt: null },
                orderBy: { timestamp: "desc" },
                take: 100,
            }),
        );
        expect((await res.json()).scans).toHaveLength(1);
    });

    it("names the person and nothing else about them — no email in the query or the body", async () => {
        // The narrow select is the minimization; the registry grant carries no
        // pii leg, so a widened select would strip rather than leak — but the
        // select is what keeps the two in agreement.
        const res = await GET(listReq());
        const { select } = db.rawBadgeLog.findMany.mock.calls[0][0];
        expect(select.person).toEqual({ select: { id: true, name: true } });

        const [row] = (await res.json()).scans;
        expect(row.person).toEqual({ id: 12, name: "Ada Lovelace" });
        expect(JSON.stringify(row)).not.toContain("@");
    });

    it("admits a board member as well as a sysadmin", async () => {
        mockSession.mockResolvedValue(BOARD);
        expect((await GET(listReq())).status).toBe(200);
    });

    it("admits a keyholder (Q15)", async () => {
        mockSession.mockResolvedValue(KEYHOLDER);
        expect((await GET(listReq())).status).toBe(200);
    });

    it("403s operations — aggregate attendance only (#1633)", async () => {
        mockSession.mockResolvedValue(OPERATIONS);
        expect((await GET(listReq())).status).toBe(403);
        expect(db.rawBadgeLog.findMany).not.toHaveBeenCalled();
    });

    it("401 anonymous / 403 plain member, without querying", async () => {
        mockSession.mockResolvedValue(null);
        expect((await GET(listReq())).status).toBe(401);

        mockSession.mockResolvedValue(MEMBER);
        expect((await GET(listReq())).status).toBe(403);

        expect(db.rawBadgeLog.findMany).not.toHaveBeenCalled();
    });
});

describe("POST /api/system-status/unsynced-scans/[id] (dismiss)", () => {
    it("stamps reviewedAt AND reviewedBy, and leaves reviewReason alone", async () => {
        const before = Date.now();
        const res = await POST(dismissReq(), dismissCtx());
        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({});

        const [call] = db.rawBadgeLog.updateMany.mock.calls;
        expect(call[0].data.reviewedBy).toBe(SYSADMIN.user.id);
        expect(call[0].data.reviewedAt).toBeInstanceOf(Date);
        expect(call[0].data.reviewedAt.getTime()).toBeGreaterThanOrEqual(before);
        // Only the two review columns move — the row keeps saying why it parked.
        expect(Object.keys(call[0].data).sort()).toEqual(["reviewedAt", "reviewedBy"]);
    });

    it("can only stamp a row that is actually parked and not yet reviewed", async () => {
        await POST(dismissReq(), dismissCtx());
        expect(db.rawBadgeLog.updateMany.mock.calls[0][0].where).toEqual({
            id: 5,
            reviewReason: { not: null },
            reviewedAt: null,
        });
    });

    it("404s a second dismiss rather than re-stamping a different reviewer over the first", async () => {
        db.rawBadgeLog.updateMany.mockResolvedValue({ count: 0 });
        expect((await POST(dismissReq(), dismissCtx())).status).toBe(404);
    });

    it("400s a non-numeric id, without writing", async () => {
        expect((await POST(dismissReq(), dismissCtx("abc"))).status).toBe(400);
        expect(db.rawBadgeLog.updateMany).not.toHaveBeenCalled();
    });

    it("admits a board member; 401 anonymous / 403 plain member, without writing", async () => {
        mockSession.mockResolvedValue(BOARD);
        expect((await POST(dismissReq(), dismissCtx())).status).toBe(200);
        expect(db.rawBadgeLog.updateMany.mock.calls[0][0].data.reviewedBy).toBe(BOARD.user.id);

        jest.clearAllMocks();
        mockSession.mockResolvedValue(null);
        expect((await POST(dismissReq(), dismissCtx())).status).toBe(401);

        mockSession.mockResolvedValue(MEMBER);
        expect((await POST(dismissReq(), dismissCtx())).status).toBe(403);

        expect(db.rawBadgeLog.updateMany).not.toHaveBeenCalled();
    });

    it("admits a keyholder dismiss; 403s operations", async () => {
        mockSession.mockResolvedValue(KEYHOLDER);
        expect((await POST(dismissReq(), dismissCtx())).status).toBe(200);
        expect(db.rawBadgeLog.updateMany.mock.calls[0][0].data.reviewedBy).toBe(KEYHOLDER.user.id);

        jest.clearAllMocks();
        mockSession.mockResolvedValue(OPERATIONS);
        expect((await POST(dismissReq(), dismissCtx())).status).toBe(403);
        expect(db.rawBadgeLog.updateMany).not.toHaveBeenCalled();
    });
});
