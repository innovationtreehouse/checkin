/**
 * @jest-environment node
 *
 * Integration tests for GET /api/my-programs/[id] — the program-lead roster +
 * attendance-summary + stats surface (and its CSV export). Covers the scoping
 * (lead sees own, others 403, board override), the PII shape (no finance-
 * confidential participant fields; scholarship is a count only), and CSV content.
 */
import { GET } from "@/app/api/my-programs/[id]/route";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import type { NextRequest } from "next/server";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
const mockSession = getServerSession as jest.Mock;

const MARK = "myprog-info-test";
const params = (id: number) => ({ params: Promise.resolve({ id: String(id) }) });
const call = (id: number, query = "") =>
  GET(new Request(`http://localhost/api/my-programs/${id}${query}`) as unknown as NextRequest, params(id) as never);

describe("GET /api/my-programs/[id]", () => {
  let leadId: number;
  let boardId: number;
  let otherLeadId: number;
  let childId: number;
  let myProgramId: number;
  let otherProgramId: number;
  let eventId: number;

  const CHILD_NAME = "Roster Child One";
  const LEAD_EMAIL = `hhlead-${MARK}@example.com`;
  const LEAD_PHONE = "5551234567";

  beforeAll(async () => {
    // Lead of the program under test (also their own household lead).
    const lead = await prisma.person.create({
      data: { email: `lead-${MARK}@example.com`, name: "Program Lead", household: { create: { name: "Lead HH" } } },
    });
    leadId = lead.id;

    const board = await prisma.person.create({
      data: { email: `board-${MARK}@example.com`, name: "Board", household: { create: { name: "Board HH" } } },
    });
    boardId = board.id;

    const otherLead = await prisma.person.create({
      data: { email: `other-${MARK}@example.com`, name: "Other Lead", household: { create: { name: "Other HH" } } },
    });
    otherLeadId = otherLead.id;

    // A participant household: a household lead (the "who to call" contact) + a child.
    const participantHH = await prisma.household.create({ data: { name: "Participant HH" } });
    await prisma.person.create({
      data: { email: LEAD_EMAIL, phone: LEAD_PHONE, name: "Parent Lead", isHouseholdLead: true, householdId: participantHH.id },
    });
    const child = await prisma.person.create({
      data: { email: `child-${MARK}@example.com`, name: CHILD_NAME, householdId: participantHH.id },
    });
    childId = child.id;
    // A second participant, PENDING with a scholarship (payment-plan) request.
    const pending = await prisma.person.create({
      data: { email: `pending-${MARK}@example.com`, name: "Pending Kid", householdId: participantHH.id },
    });

    const myProgram = await prisma.program.create({ data: { name: `My Prog ${MARK}`, phase: "RUNNING", maxParticipants: 10, leadMentorId: leadId } });
    myProgramId = myProgram.id;
    const otherProgram = await prisma.program.create({ data: { name: `Other Prog ${MARK}`, phase: "RUNNING", leadMentorId: otherLeadId } });
    otherProgramId = otherProgram.id;

    await prisma.programParticipant.create({ data: { programId: myProgramId, personId: childId, status: "ACTIVE" } });
    await prisma.programParticipant.create({ data: { programId: myProgramId, personId: pending.id, status: "PENDING", isPaymentPlanRequested: true } });

    const event = await prisma.event.create({
      data: { name: "Session 1", programId: myProgramId, startAt: new Date("2026-02-01T18:00:00Z"), endAt: new Date("2026-02-01T20:00:00Z"), attendanceConfirmedAt: new Date("2026-02-01T20:05:00Z") },
    });
    eventId = event.id;
    // The child attended; two visit rows for one event must still count as one.
    await prisma.visit.create({ data: { personId: childId, associatedEventId: eventId, arrivedAt: new Date("2026-02-01T18:05:00Z"), departedAt: new Date("2026-02-01T19:00:00Z") } });
    await prisma.visit.create({ data: { personId: childId, associatedEventId: eventId, arrivedAt: new Date("2026-02-01T18:10:00Z"), departedAt: new Date("2026-02-01T19:10:00Z") } });
  });

  afterAll(async () => {
    await prisma.visit.deleteMany({ where: { associatedEventId: eventId } });
    await prisma.event.deleteMany({ where: { programId: { in: [myProgramId, otherProgramId] } } });
    await prisma.programParticipant.deleteMany({ where: { programId: { in: [myProgramId, otherProgramId] } } });
    await prisma.program.deleteMany({ where: { id: { in: [myProgramId, otherProgramId] } } });
    const people = await prisma.person.findMany({ where: { email: { contains: MARK } }, select: { id: true, householdId: true } });
    await prisma.person.deleteMany({ where: { id: { in: people.map((p) => p.id) } } });
    await prisma.household.deleteMany({ where: { id: { in: people.map((p) => p.householdId) } } });
  });

  it("lets the lead see their own program's roster, stats, and turnout", async () => {
    mockSession.mockResolvedValue({ user: { id: leadId } });
    const res = await call(myProgramId);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.program.name).toBe(`My Prog ${MARK}`);
    expect(data.program.enrolled).toBe(1);
    expect(data.program.pending).toBe(1);
    expect(data.program.capacity).toBe(10);
    expect(data.program.eventCount).toBe(1);
    expect(data.program.scholarshipRequests).toBe(1);

    const child = data.roster.find((r: { personId: number }) => r.personId === childId);
    expect(child.name).toBe(CHILD_NAME);
    expect(child.status).toBe("ACTIVE");
    expect(child.contact).toEqual({ name: "Parent Lead", email: LEAD_EMAIL, phone: LEAD_PHONE });
    expect(child.attendanceCount).toBe(1); // two visit rows, one event

    expect(data.events[0]).toMatchObject({ eventId, turnout: 1, name: "Session 1" });
    expect(data.events[0].attendanceConfirmedAt).not.toBeNull();
  });

  it("never exposes finance-confidential participant fields (scholarship is a count only)", async () => {
    mockSession.mockResolvedValue({ user: { id: leadId } });
    const res = await call(myProgramId);
    const data = await res.json();
    const blob = JSON.stringify(data);
    expect(blob).not.toContain("isPaymentPlanRequested");
    expect(blob).not.toContain("paymentPlanDeniedAt");
    expect(blob).not.toContain("inventoryHeldAt");
    expect(blob).not.toContain("pendingSince");
    for (const r of data.roster) {
      expect(r.isPaymentPlanRequested).toBeUndefined();
      expect(r.paymentPlanDeniedAt).toBeUndefined();
    }
  });

  it("403s a caller who does not lead the program and is not board", async () => {
    mockSession.mockResolvedValue({ user: { id: otherLeadId } });
    expect((await call(myProgramId)).status).toBe(403);
  });

  it("lets a board member view any program (override)", async () => {
    mockSession.mockResolvedValue({ user: { id: boardId, isBoardMember: true } });
    const res = await call(otherProgramId);
    expect(res.status).toBe(200);
    expect((await res.json()).program.name).toBe(`Other Prog ${MARK}`);
  });

  it("404s a missing program and 401s the unauthenticated", async () => {
    mockSession.mockResolvedValue({ user: { id: leadId } });
    expect((await call(99999999)).status).toBe(404);
    mockSession.mockResolvedValue(null);
    expect((await call(myProgramId)).status).toBe(401);
  });

  it("exports roster CSV with contact columns and the right filename", async () => {
    mockSession.mockResolvedValue({ user: { id: leadId } });
    const res = await call(myProgramId, "?format=csv&kind=roster");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toBe(`attachment; filename="program-${myProgramId}-roster.csv"`);
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe("Name,Status,Household Lead,Email,Phone,Events Attended,Last Seen");
    expect(body).toContain(CHILD_NAME);
    expect(body).toContain(LEAD_EMAIL);
    expect(body.toLowerCase()).not.toContain("paymentplan");
  });

  it("exports events CSV with per-session turnout", async () => {
    mockSession.mockResolvedValue({ user: { id: leadId } });
    const res = await call(myProgramId, "?format=csv&kind=events");
    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe("Session,Date,Attendance Confirmed,Turnout");
    expect(body).toContain("Session 1,2026-02-01,yes,1");
  });
});
