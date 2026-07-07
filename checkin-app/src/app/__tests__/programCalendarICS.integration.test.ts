/**
 * @jest-environment node
 */
/**
 * Integration tests for GET /api/programs/[id]/calendar.ics — the program event
 * schedule export. Asserts (1) the visibility gate mirrors GET /api/programs/[id]
 * (signed-in only; member-only programs gated to members/staff) and (2) the
 * response is a well-formed, correctly-typed .ics download.
 */
import { GET } from "@/app/api/programs/[id]/calendar.ics/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import type { NextRequest } from "next/server";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));

const TAG = "cal-ics-int-test";

describe("GET /api/programs/[id]/calendar.ics", () => {
    let adminId: number;
    let leadId: number;
    let commonId: number;
    let memberId: number;
    let memberHouseholdId: number;
    let publicProgramId: number;
    let memberOnlyProgramId: number;
    let emptyProgramId: number;

    beforeAll(async () => {
        // Idempotent cleanup of any prior leaked run.
        const stale = await prisma.person.findMany({ where: { email: { contains: TAG } }, select: { id: true, householdId: true } });
        const staleHouseholds = stale.map((p) => p.householdId);
        await prisma.orgMembership.deleteMany({ where: { householdId: { in: staleHouseholds } } });
        const stalePrograms = await prisma.program.findMany({ where: { name: { contains: TAG } }, select: { id: true } });
        await prisma.event.deleteMany({ where: { programId: { in: stalePrograms.map((p) => p.id) } } });
        await prisma.program.deleteMany({ where: { name: { contains: TAG } } });
        await prisma.person.deleteMany({ where: { id: { in: stale.map((p) => p.id) } } });

        const admin = await prisma.person.create({ data: { email: `admin-${TAG}@example.com`, name: "Admin", isSysadmin: true, household: { create: { name: "HH" } } } });
        adminId = admin.id;
        const lead = await prisma.person.create({ data: { email: `lead-${TAG}@example.com`, name: "Lead", household: { create: { name: "HH" } } } });
        leadId = lead.id;
        const common = await prisma.person.create({ data: { email: `common-${TAG}@example.com`, name: "Common", household: { create: { name: "HH" } } } });
        commonId = common.id;
        const member = await prisma.person.create({
            data: {
                email: `member-${TAG}@example.com`, name: "Member",
                household: { create: { name: "HH", orgMembership: { create: { status: "ACTIVE", memberSince: new Date() } } } },
            },
            select: { id: true, householdId: true },
        });
        memberId = member.id;
        memberHouseholdId = member.householdId;

        const publicProgram = await prisma.program.create({ data: { name: `Public ${TAG}`, phase: "RUNNING", orgMemberOnly: false, leadMentorId: leadId } });
        publicProgramId = publicProgram.id;
        // Two events, deliberately out of order + text that MUST be RFC-escaped.
        await prisma.event.create({ data: { programId: publicProgramId, name: `Session 2 ${TAG}`, startAt: new Date("2026-08-10T18:00:00Z"), endAt: new Date("2026-08-10T20:00:00Z") } });
        await prisma.event.create({ data: { programId: publicProgramId, name: `Robotics, Level 1; ${TAG}`, description: "Bring a laptop\nand a charger", startAt: new Date("2026-08-03T18:00:00Z"), endAt: new Date("2026-08-03T20:00:00Z") } });

        const memberOnly = await prisma.program.create({ data: { name: `MemberOnly ${TAG}`, phase: "RUNNING", orgMemberOnly: true, leadMentorId: leadId } });
        memberOnlyProgramId = memberOnly.id;
        await prisma.event.create({ data: { programId: memberOnlyProgramId, name: `Secret ${TAG}`, startAt: new Date("2026-09-01T18:00:00Z"), endAt: new Date("2026-09-01T20:00:00Z") } });

        const empty = await prisma.program.create({ data: { name: `Empty ${TAG}`, phase: "RUNNING", orgMemberOnly: false, leadMentorId: leadId } });
        emptyProgramId = empty.id;
    });

    afterAll(async () => {
        const programIds = [publicProgramId, memberOnlyProgramId, emptyProgramId].filter(Boolean);
        await prisma.event.deleteMany({ where: { programId: { in: programIds } } });
        await prisma.program.deleteMany({ where: { id: { in: programIds } } });
        if (memberHouseholdId) await prisma.orgMembership.deleteMany({ where: { householdId: memberHouseholdId } });
        await prisma.person.deleteMany({ where: { id: { in: [adminId, leadId, commonId, memberId] } } });
    });

    const params = (id: number) => ({ params: Promise.resolve({ id: id.toString() }) });
    const req = (id: number) => new Request(`http://localhost:4000/api/programs/${id}/calendar.ics`) as unknown as NextRequest;
    const call = (id: number) => GET(req(id), params(id) as unknown as never);

    it("returns 401 for an unauthenticated caller", async () => {
        (getServerSession as jest.Mock).mockResolvedValue(null);
        const res = await call(publicProgramId);
        expect(res.status).toBe(401);
    });

    it("serves a signed-in common user a text/calendar attachment for a public program", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });
        const res = await call(publicProgramId);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/text\/calendar/);
        expect(res.headers.get("content-disposition")).toBe(`attachment; filename="program-${publicProgramId}.ics"`);

        const body = await res.text();
        expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
        expect(body.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
        expect(body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
        // Escaping is applied to real event text.
        expect(body).toContain(`SUMMARY:Robotics\\, Level 1\\; ${TAG}`);
        expect(body).toContain("DESCRIPTION:Bring a laptop\\nand a charger");
        expect(body).toContain("DTSTART:20260803T180000Z");
        expect(body).toContain("DTEND:20260803T200000Z");
        // UID is stable per event id + host.
        expect(body).toMatch(/UID:program-event-\d+@localhost:4000/);
    });

    it("returns a valid empty VCALENDAR for a program with no events", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });
        const res = await call(emptyProgramId);
        expect(res.status).toBe(200);
        const body = await res.text();
        expect(body).toContain("BEGIN:VCALENDAR");
        expect(body).toContain("END:VCALENDAR");
        expect(body).not.toContain("BEGIN:VEVENT");
    });

    it("blocks a signed-in non-member from a member-only program (403)", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: commonId } });
        const res = await call(memberOnlyProgramId);
        expect(res.status).toBe(403);
    });

    it("serves an active member the member-only program schedule", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: memberId } });
        const res = await call(memberOnlyProgramId);
        expect(res.status).toBe(200);
        expect(await res.text()).toContain(`SUMMARY:Secret ${TAG}`);
    });

    it("serves an admin the member-only schedule without a membership", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        const res = await call(memberOnlyProgramId);
        expect(res.status).toBe(200);
    });

    it("serves the lead mentor their own member-only program schedule", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: leadId } });
        const res = await call(memberOnlyProgramId);
        expect(res.status).toBe(200);
    });

    it("returns 404 for a missing program and 400 for an unparseable id", async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: adminId, isSysadmin: true } });
        expect((await call(99999999)).status).toBe(404);

        const badRes = await GET(
            new Request("http://localhost:4000/api/programs/abc/calendar.ics") as unknown as NextRequest,
            { params: Promise.resolve({ id: "abc" }) } as unknown as never,
        );
        expect(badRes.status).toBe(400);
    });
});
