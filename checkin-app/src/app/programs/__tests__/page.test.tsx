// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import PublicProgramsDirectory from "../page";

beforeEach(() => resetRtl());

const programs = [
  {
    id: 1, name: "Robotics Club", startAt: "2026-01-10T00:00:00.000Z", endAt: "2026-05-10T00:00:00.000Z",
    orgMemberOnly: false, phase: "RUNNING", enrollmentStatus: "OPEN", leadMentorId: 1,
    _count: { participants: 4, volunteers: 1, events: 2 },
  },
];

describe("PublicProgramsDirectory", () => {
  it("lists public programs for an anonymous visitor", async () => {
    mockFetchJson({ "/api/programs?active=true": programs });
    renderWithProviders(<PublicProgramsDirectory />);

    expect(await screen.findByText("Robotics Club")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View details and enroll" })).toHaveAttribute("href", "/programs/1");
    // Anonymous visitors get no manage/admin controls.
    expect(screen.queryByRole("checkbox", { name: "Show active only" })).not.toBeInTheDocument();
  });

  it("shows admin controls and a Manage link for an authorized admin", async () => {
    setSession({ id: 1, isSysadmin: true });
    // Unchecking "active only" re-fetches with no query string.
    mockFetchJson({ "/api/programs?active=true": programs, "/api/programs": programs });
    renderWithProviders(<PublicProgramsDirectory />);

    expect(await screen.findByText("Robotics Club")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/program-ops/programs/1");

    fireEvent.click(screen.getByLabelText("Show active only"));
    await waitFor(() => expect(screen.getByLabelText("Show active only")).not.toBeChecked());
  });

  it("shows an empty state with no active programs", async () => {
    mockFetchJson({ "/api/programs?active=true": [] });
    renderWithProviders(<PublicProgramsDirectory />);
    expect(await screen.findByText(/No active programs currently available/)).toBeInTheDocument();
  });
});
