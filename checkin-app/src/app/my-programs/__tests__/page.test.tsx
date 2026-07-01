// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import MyProgramsHome from "../page";

beforeEach(() => resetRtl());

const tally = { yes: 2, maybe: 1, no: 0 };

const todoCounts = {
  lead: {
    programs: [
      {
        id: 1,
        name: "Robotics Club",
        totalEnrolled: 5,
        upcoming: [{ eventId: 10, name: "Session 1", startAt: "2026-02-01T18:00:00.000Z", participants: tally, volunteers: tally }],
        pending: [{ key: "e10", href: "/program-ops/sessions/10", label: "Confirm Session 1" }],
      },
      {
        id: 2,
        name: "Pottery",
        totalEnrolled: 3,
        upcoming: [],
        pending: [],
      },
    ],
  },
};

describe("MyProgramsHome", () => {
  it("lists led programs with their pending attendance", async () => {
    setSession({ id: 1 });
    mockFetchJson({ "/api/nav/todo-counts": todoCounts });
    renderWithProviders(<MyProgramsHome />);

    expect(await screen.findByText("Robotics Club")).toBeInTheDocument();
    expect(screen.getByText("Confirm Session 1")).toBeInTheDocument();
    expect(screen.getByText("Pottery")).toBeInTheDocument();
    expect(screen.getByText("No attendance to confirm.")).toBeInTheDocument();
  });

  it("filters programs by the search box", async () => {
    setSession({ id: 1 });
    mockFetchJson({ "/api/nav/todo-counts": todoCounts });
    renderWithProviders(<MyProgramsHome />);
    await screen.findByText("Robotics Club");

    fireEvent.change(screen.getByPlaceholderText("Filter by program or session name"), { target: { value: "Pottery" } });
    expect(screen.getByText("Pottery")).toBeInTheDocument();
    expect(screen.queryByText("Robotics Club")).not.toBeInTheDocument();
  });
});
