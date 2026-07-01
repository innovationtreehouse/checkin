// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import ParticipationTrendsPage from "../page";

beforeEach(() => resetRtl());

const trendsData = {
  buckets: [
    { label: "Jan 2026", periodStart: "2026-01-01", uniqueVolunteers: 3, uniqueStudents: 5, totalVolunteerHours: 12.5, totalStudentHours: 0.5, structuredHours: 8, unstructuredHours: 4.5 },
  ],
  totals: { label: "Total", periodStart: "", uniqueVolunteers: 3, uniqueStudents: 5, totalVolunteerHours: 12.5, totalStudentHours: 0.5, structuredHours: 8, unstructuredHours: 4.5 },
};

function mockRoutes() {
  return mockFetchJson({
    "/api/programs": [{ id: 1, name: "Robotics" }],
    "/api/facility/trends": trendsData,
  });
}

describe("facility-ops/trends page", () => {
  it("loads and renders period totals and the bucket table", async () => {
    setSession({ id: 1, isBoardMember: true });
    mockRoutes();
    renderWithProviders(<ParticipationTrendsPage />);

    expect(await screen.findByText("Jan 2026")).toBeInTheDocument();
    expect(screen.getByText("Unique Volunteers")).toBeInTheDocument();
    expect(screen.getAllByText("3").length).toBeGreaterThan(0); // uniqueVolunteers, in both the stat card and table
    expect(screen.getAllByText("30m").length).toBeGreaterThan(0); // totalStudentHours 0.5h -> "30m"
  });

  it("re-fetches trends when the period changes", async () => {
    setSession({ id: 1, isBoardMember: true });
    const fetchMock = mockRoutes();
    renderWithProviders(<ParticipationTrendsPage />);
    await screen.findByText("Jan 2026");

    fireEvent.click(screen.getByText("Week"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("period=week")),
    );
  });
});
