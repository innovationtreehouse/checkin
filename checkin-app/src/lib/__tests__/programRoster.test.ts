import { summarizeVisits, toLeadContact, toCsv, rosterCsv, eventsCsv, type ProgramInfo } from "@/lib/programRoster";

describe("summarizeVisits", () => {
  it("counts distinct events per person, keeps the latest arrival, and distinct people per event", () => {
    const d = (s: string) => new Date(s);
    const { eventsByPerson, lastSeenByPerson, peopleByEvent } = summarizeVisits([
      { personId: 1, associatedEventId: 10, arrivedAt: d("2026-02-01T18:00:00Z") },
      { personId: 1, associatedEventId: 10, arrivedAt: d("2026-02-01T18:30:00Z") }, // dup event → same count
      { personId: 1, associatedEventId: 11, arrivedAt: d("2026-02-08T18:00:00Z") },
      { personId: 2, associatedEventId: 10, arrivedAt: d("2026-02-01T18:10:00Z") },
      { personId: 3, associatedEventId: null, arrivedAt: d("2026-02-01T18:00:00Z") }, // unassociated → ignored
    ]);

    expect(eventsByPerson.get(1)?.size).toBe(2); // events 10 & 11, dup collapsed
    expect(eventsByPerson.get(2)?.size).toBe(1);
    expect(eventsByPerson.has(3)).toBe(false);
    expect(lastSeenByPerson.get(1)?.toISOString()).toBe("2026-02-08T18:00:00.000Z");
    expect(peopleByEvent.get(10)?.size).toBe(2); // persons 1 & 2
    expect(peopleByEvent.get(11)?.size).toBe(1);
  });
});

describe("toLeadContact", () => {
  it("returns null for a lead-less household and joins multiple leads", () => {
    expect(toLeadContact([])).toBeNull();
    expect(toLeadContact([{ name: "A", email: "a@x.com", phone: null }, { name: "B", email: null, phone: "555" }])).toEqual({
      name: "A; B",
      email: "a@x.com",
      phone: "555",
    });
  });
});

describe("toCsv", () => {
  it("quotes cells containing commas, quotes, or newlines (RFC 4180)", () => {
    const csv = toCsv(["a", "b"], [["plain", 'has,comma'], ['has"quote', "line\nbreak"]]);
    expect(csv).toBe('a,b\r\nplain,"has,comma"\r\n"has""quote","line\nbreak"\r\n');
  });
});

const info: ProgramInfo = {
  program: { id: 7, name: "Robotics", enrolled: 2, pending: 1, capacity: 10, eventCount: 1, scholarshipRequests: 3 },
  roster: [
    { personId: 1, name: "Kid, One", status: "ACTIVE", contact: { name: "Parent", email: "p@x.com", phone: "555" }, attendanceCount: 2, lastSeenAt: "2026-02-08T18:00:00.000Z" },
    { personId: 2, name: "Kid Two", status: "PENDING", contact: null, attendanceCount: 0, lastSeenAt: null },
  ],
  events: [{ eventId: 10, name: "Session 1", startAt: "2026-02-01T18:00:00.000Z", attendanceConfirmedAt: "2026-02-01T20:00:00.000Z", turnout: 2 }],
};

describe("rosterCsv", () => {
  it("emits a header row + one row per participant, escaping the comma in a name", () => {
    const lines = rosterCsv(info).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Name,Status,Household Lead,Email,Phone,Events Attended,Last Seen");
    expect(lines[1]).toBe('"Kid, One",ACTIVE,Parent,p@x.com,555,2,2026-02-08');
    expect(lines[2]).toBe("Kid Two,PENDING,,,,0,");
  });

  it("never emits any finance-confidential column", () => {
    const csv = rosterCsv(info).toLowerCase();
    expect(csv).not.toContain("payment");
    expect(csv).not.toContain("scholarship");
    expect(csv).not.toContain("inventory");
  });
});

describe("eventsCsv", () => {
  it("emits per-session turnout with a confirmed flag", () => {
    const lines = eventsCsv(info).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Session,Date,Attendance Confirmed,Turnout");
    expect(lines[1]).toBe("Session 1,2026-02-01,yes,2");
  });
});
