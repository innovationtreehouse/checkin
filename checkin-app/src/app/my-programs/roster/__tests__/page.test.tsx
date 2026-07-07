// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import RosterPage from "../page";

beforeEach(() => resetRtl());

const info = {
  program: { id: 1, name: "Robotics", enrolled: 1, pending: 0, capacity: 10, eventCount: 1, scholarshipRequests: 2 },
  roster: [
    { personId: 5, name: "Kid One", status: "ACTIVE", contact: { name: "Parent Lead", email: "p@x.com", phone: "555" }, attendanceCount: 1, lastSeenAt: "2026-02-01T18:00:00.000Z" },
  ],
  events: [
    { eventId: 10, name: "Session 1", startAt: "2026-02-01T18:00:00.000Z", attendanceConfirmedAt: "2026-02-01T20:00:00.000Z", turnout: 1 },
  ],
};

describe("RosterPage", () => {
  it("renders stats, roster contact info, and session turnout for the led program", async () => {
    setSession({ id: 1 });
    mockFetchJson({
      "/api/nav/todo-counts": { lead: { programs: [{ id: 1, name: "Robotics", totalEnrolled: 1, pending: [], upcoming: [] }] } },
      "/api/my-programs/1": info,
    });
    renderWithProviders(<RosterPage />);

    expect(await screen.findByText("Kid One")).toBeInTheDocument();
    expect(screen.getByText("Parent Lead")).toBeInTheDocument();
    expect(screen.getByText("p@x.com")).toBeInTheDocument();
    expect(screen.getByText("1 / 10")).toBeInTheDocument(); // enrollment vs capacity
    expect(screen.getByText("2")).toBeInTheDocument(); // scholarship request count
    expect(screen.getByText("Session 1")).toBeInTheDocument();
    // CSV export affordances are present.
    expect(screen.getByRole("link", { name: /Roster CSV/ })).toHaveAttribute("href", "/api/my-programs/1?format=csv&kind=roster");
  });
});
