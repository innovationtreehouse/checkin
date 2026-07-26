/**
 * @jest-environment node
 *
 * Self-correction of own visits (AT5, #1256): PATCH edits times, DELETE
 * tombstones. The invariants under test: ownership is the only gate (404 on
 * not-yours/tombstoned — no existence oracle), validity checks reject bad
 * times, the write is audited with type "self_correction" + significance, a
 * significant change emails the board, a delete never removes the row, and
 * closing an open visit routes through processVisitCheckout.
 */

import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import prisma from "@/lib/prisma";
import { processVisitCheckout } from "@/lib/attendanceTransitions";
import { emailBoardMembers } from "@/lib/emailRecipients";
import { PATCH, DELETE } from "@/app/api/attendance/manual/[id]/route";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-options", () => ({ authOptions: {} }));
jest.mock("@/lib/verify-kiosk", () => ({
    getKioskPublicKeys: jest.fn().mockReturnValue([]),
    verifyKioskSignature: jest.fn().mockReturnValue({ ok: false }),
}));
jest.mock("@/lib/attendanceTransitions", () => ({ processVisitCheckout: jest.fn().mockResolvedValue([]) }));
jest.mock("@/lib/emailRecipients", () => ({ emailBoardMembers: jest.fn().mockResolvedValue(undefined) }));

const tx = {
    $executeRaw: jest.fn(),
    visit: { update: jest.fn() },
};
jest.mock("@/lib/prisma", () => ({
    __esModule: true,
    default: {
        visit: { findUnique: jest.fn(), update: jest.fn() },
        auditLog: { create: jest.fn() },
        $transaction: jest.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    },
}));

const mockSession = getServerSession as jest.Mock;
const visitFindUnique = prisma.visit.findUnique as jest.Mock;
const auditCreate = prisma.auditLog.create as jest.Mock;

const OWN_ID = 7;
const baseVisit = {
    id: 42, personId: OWN_ID, deletedAt: null, deletedById: null, associatedEventId: null,
    arrivedAt: new Date("2026-07-20T14:00:00Z"), departedAt: new Date("2026-07-20T16:00:00Z"),
    arrivedVia: "WEB", departedVia: "WEB",
};

function req(method: string, body?: unknown): NextRequest {
    return new Request("http://localhost/api/attendance/manual/42", {
        method,
        headers: { "content-type": "application/json" },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }) as unknown as NextRequest;
}
const ctx = { params: Promise.resolve({ id: "42" }) };

beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: OWN_ID } });
    tx.visit.update.mockImplementation(async (args: { data: Record<string, unknown> }) => ({ ...baseVisit, ...args.data }));
    auditCreate.mockResolvedValue({});
});

describe("PATCH /api/attendance/manual/[id]", () => {
    it("401s an unauthenticated caller", async () => {
        mockSession.mockResolvedValue(null);
        const res = await PATCH(req("PATCH", { arrivedAt: new Date().toISOString() }), ctx as never);
        expect(res.status).toBe(401);
    });

    it("404s someone else's visit and a tombstoned visit alike", async () => {
        visitFindUnique.mockResolvedValueOnce({ ...baseVisit, personId: 99 });
        expect((await PATCH(req("PATCH", { arrivedAt: "2026-07-20T14:05:00Z" }), ctx as never)).status).toBe(404);

        visitFindUnique.mockResolvedValueOnce({ ...baseVisit, deletedAt: new Date() });
        expect((await PATCH(req("PATCH", { arrivedAt: "2026-07-20T14:05:00Z" }), ctx as never)).status).toBe(404);
        expect(tx.visit.update).not.toHaveBeenCalled();
    });

    it("rejects a departure before the arrival", async () => {
        visitFindUnique.mockResolvedValue(baseVisit);
        const res = await PATCH(req("PATCH", { departedAt: "2026-07-20T13:00:00Z" }), ctx as never);
        expect(res.status).toBe(400);
    });

    it("applies a small edit unflagged: WEB sources, audit row, no board email", async () => {
        visitFindUnique.mockResolvedValue(baseVisit);
        const res = await PATCH(req("PATCH", { arrivedAt: "2026-07-20T14:05:00Z" }), ctx as never);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ flagged: false });
        expect(tx.visit.update).toHaveBeenCalledWith(expect.objectContaining({
            data: { arrivedAt: new Date("2026-07-20T14:05:00Z"), arrivedVia: "WEB" },
        }));
        const audit = auditCreate.mock.calls[0][0].data;
        expect(audit).toMatchObject({
            action: "EDIT", tableName: "Visit", affectedEntityId: 42,
            actorId: OWN_ID, secondaryAffectedEntity: OWN_ID,
        });
        expect(audit.newData.type).toBe("self_correction");
        expect(audit.newData.significance.flagged).toBe(false);
        expect(emailBoardMembers).not.toHaveBeenCalled();
    });

    it("flags a big move of a measured (SCANNER) arrival to the board", async () => {
        visitFindUnique.mockResolvedValue({ ...baseVisit, arrivedVia: "SCANNER", departedVia: "SCANNER" });
        const res = await PATCH(req("PATCH", { arrivedAt: "2026-07-20T12:00:00Z" }), ctx as never);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ flagged: true });
        expect(emailBoardMembers).toHaveBeenCalledTimes(1);
    });

    it("never reopens a closed visit", async () => {
        visitFindUnique.mockResolvedValue(baseVisit);
        const res = await PATCH(req("PATCH", { arrivedAt: "2026-07-20T14:05:00Z", departedAt: "" }), ctx as never);
        expect(res.status).toBe(200); // absent departedAt = keep the existing one
        expect(tx.visit.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.not.objectContaining({ departedAt: expect.anything() }),
        }));
    });

    it("closing an open visit goes through processVisitCheckout, not a bare update", async () => {
        visitFindUnique.mockResolvedValue({ ...baseVisit, departedAt: null, departedVia: null });
        const res = await PATCH(req("PATCH", { departedAt: "2026-07-20T17:00:00Z" }), ctx as never);

        expect(res.status).toBe(200);
        expect(processVisitCheckout).toHaveBeenCalledWith(42, new Date("2026-07-20T17:00:00Z"), undefined, "WEB");
        // The lock-scoped update must not have closed it first.
        expect(tx.visit.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.not.objectContaining({ departedAt: expect.anything() }),
        }));
        // Routine close of one's own open visit is not board-worthy.
        expect(emailBoardMembers).not.toHaveBeenCalled();
    });
});

describe("DELETE /api/attendance/manual/[id]", () => {
    it("tombstones (update, never delete) and always flags to the board", async () => {
        visitFindUnique.mockResolvedValue(baseVisit);
        const res = await DELETE(req("DELETE"), ctx as never);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, flagged: true });
        expect(tx.visit.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 42 },
            data: expect.objectContaining({ deletedAt: expect.any(Date), deletedById: OWN_ID }),
        }));
        const audit = auditCreate.mock.calls[0][0].data;
        expect(audit).toMatchObject({ action: "DELETE", tableName: "Visit", affectedEntityId: 42 });
        expect(audit.newData.significance.flagged).toBe(true);
        expect(emailBoardMembers).toHaveBeenCalledTimes(1);
    });

    it("404s a double delete (already tombstoned)", async () => {
        visitFindUnique.mockResolvedValue({ ...baseVisit, deletedAt: new Date() });
        const res = await DELETE(req("DELETE"), ctx as never);
        expect(res.status).toBe(404);
        expect(tx.visit.update).not.toHaveBeenCalled();
    });
});
