/**
 * @jest-environment node
 */
/**
 * Integration tests for /api/facility/badge-prints (report GET + mark-printed
 * POST). Real Postgres. Covers: authz 401/403, single + bulk mark, the report's
 * printed/gap lists correct across a calendar-year boundary, and the
 * duplicates/reprint behavior (multiple rows per person, de-duped in the report).
 */
import { GET, POST } from "@/app/api/facility/badge-prints/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));

const TAG = "badge-prints-test";

describe("facility/badge-prints API", () => {
    let adminId: number;
    let householdId: number;
    let visitor2025Id: number; // visited in 2025 only
    let visitor2026Id: number; // visited in 2026, no print -> a 2026 gap
    let printedId: number; // visited + printed in 2026

    const as = (user: object | null) =>
        (getServerSession as jest.Mock).mockResolvedValue(user === null ? null : { user });

    const getReport = async (query = "") => {
        const req = new Request(`http://localhost/api/facility/badge-prints${query}`, { method: "GET" });
        return GET(req as never);
    };
    const post = async (body: unknown) => {
        const req = new Request("http://localhost/api/facility/badge-prints", {
            method: "POST",
            body: JSON.stringify(body),
        });
        return POST(req as never);
    };

    beforeAll(async () => {
        const admin = await prisma.person.create({
            data: { email: `admin-${TAG}@example.com`, name: `Admin ${TAG}`, isSysadmin: true, household: { create: { name: `HH ${TAG}` } } },
        });
        adminId = admin.id;
        householdId = admin.householdId;

        const mk = async (label: string) =>
            (await prisma.person.create({ data: { email: `${label}-${TAG}@example.com`, name: `${label} ${TAG}`, householdId } })).id;
        visitor2025Id = await mk("v2025");
        visitor2026Id = await mk("v2026");
        printedId = await mk("printed");

        // Visits: 2025-only person, and two 2026 visitors.
        await prisma.visit.createMany({
            data: [
                { personId: visitor2025Id, arrivedAt: new Date(Date.UTC(2025, 5, 1)), arrivedVia: "WEB" },
                { personId: visitor2026Id, arrivedAt: new Date(Date.UTC(2026, 5, 1)), arrivedVia: "WEB" },
                { personId: printedId, arrivedAt: new Date(Date.UTC(2026, 5, 1)), arrivedVia: "WEB" },
            ],
        });
    });

    afterAll(async () => {
        const ids = [adminId, visitor2025Id, visitor2026Id, printedId];
        await prisma.badgePrint.deleteMany({ where: { personId: { in: ids } } });
        await prisma.visit.deleteMany({ where: { personId: { in: ids } } });
        await prisma.person.deleteMany({ where: { id: { in: ids } } });
        await prisma.household.deleteMany({ where: { id: householdId } });
        await prisma.$disconnect();
    });

    beforeEach(() => jest.clearAllMocks());

    // ---- authz ----------------------------------------------------------------
    it("GET 401 unauthenticated, 403 for a plain user", async () => {
        as(null);
        expect((await getReport("?year=2026")).status).toBe(401);
        as({ id: visitor2026Id, isSysadmin: false, isBoardMember: false });
        expect((await getReport("?year=2026")).status).toBe(403);
    });
    it("POST 401 unauthenticated, 403 for a plain user", async () => {
        as(null);
        expect((await post({ personIds: [printedId] })).status).toBe(401);
        as({ id: visitor2026Id, isSysadmin: false, isBoardMember: false });
        expect((await post({ personIds: [printedId] })).status).toBe(403);
    });

    // ---- mark printed: single + bulk ------------------------------------------
    it("marks a single person printed with the caller as actor", async () => {
        as({ id: adminId, isSysadmin: true });
        const res = await post({ personIds: [printedId], note: "  new member  " });
        expect(res.status).toBe(200);
        expect((await res.json()).created).toBe(1);

        const rows = await prisma.badgePrint.findMany({ where: { personId: printedId } });
        expect(rows).toHaveLength(1);
        expect(rows[0].printedById).toBe(adminId);
        expect(rows[0].note).toBe("new member"); // trimmed
    });

    it("bulk-marks several people in one call (board member allowed)", async () => {
        as({ id: adminId, isBoardMember: true });
        const res = await post({ personIds: [visitor2025Id, visitor2026Id] });
        expect(res.status).toBe(200);
        expect((await res.json()).created).toBe(2);
        expect(await prisma.badgePrint.count({ where: { personId: { in: [visitor2025Id, visitor2026Id] } } })).toBe(2);
    });

    it("rejects an empty / non-array personIds with 400", async () => {
        as({ id: adminId, isSysadmin: true });
        expect((await post({ personIds: [] })).status).toBe(400);
        expect((await post({})).status).toBe(400);
    });

    // ---- report: year boundaries + gaps ---------------------------------------
    it("reports printed + gaps correctly, respecting the calendar-year boundary", async () => {
        // Reset to a known state: printed person got a 2026 print; visitor2026 has
        // none; give visitor2025 a print stamped in 2025 (out of the 2026 window).
        await prisma.badgePrint.deleteMany({
            where: { personId: { in: [visitor2025Id, visitor2026Id, printedId] } },
        });
        await prisma.badgePrint.create({
            data: { personId: printedId, printedById: adminId, printedAt: new Date(Date.UTC(2026, 2, 1)) },
        });
        await prisma.badgePrint.create({
            data: { personId: visitor2025Id, printedById: adminId, printedAt: new Date(Date.UTC(2025, 11, 31, 23, 0)) },
        });

        as({ id: adminId, isSysadmin: true });
        const data = await (await getReport("?year=2026")).json();

        const printedIds = data.printed.map((p: { personId: number }) => p.personId);
        const gapIds = data.gaps.map((g: { personId: number }) => g.personId);

        // printedId: printed in 2026 -> printed list, not a gap.
        expect(printedIds).toContain(printedId);
        expect(gapIds).not.toContain(printedId);
        // visitor2026: visited 2026, no 2026 print -> gap.
        expect(gapIds).toContain(visitor2026Id);
        expect(printedIds).not.toContain(visitor2026Id);
        // visitor2025: no 2026 visit -> not in the 2026 population at all; its 2025
        // print is out of the 2026 window.
        expect(printedIds).not.toContain(visitor2025Id);
        expect(gapIds).not.toContain(visitor2025Id);

        // The 2025 print shows up under year=2025 for visitor2025.
        const data2025 = await (await getReport("?year=2025")).json();
        expect(data2025.printed.map((p: { personId: number }) => p.personId)).toContain(visitor2025Id);
    });

    // ---- duplicates / reprints ------------------------------------------------
    it("allows reprints (multiple rows) and de-dupes them in the report with a count", async () => {
        await prisma.badgePrint.deleteMany({ where: { personId: printedId } });
        as({ id: adminId, isSysadmin: true });
        await post({ personIds: [printedId], note: "first" });
        await post({ personIds: [printedId], note: "reprint" });
        expect(await prisma.badgePrint.count({ where: { personId: printedId } })).toBe(2);

        const data = await (await getReport("?year=2026")).json();
        const entry = data.printed.find((p: { personId: number }) => p.personId === printedId);
        expect(entry.count).toBe(2); // two prints, one report row
    });
});
