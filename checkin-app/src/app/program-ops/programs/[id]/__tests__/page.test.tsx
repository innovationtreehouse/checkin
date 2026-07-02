// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import ProgramDetailsPage from "../page";

// React's `use()` suspends on a bare Promise until its microtask settles, which
// needs an async act() the RTL render() doesn't provide. Pre-tagging the promise
// as already-fulfilled (the same fields React's `use()` checks) makes `use()`
// return the value synchronously, so a plain render() works.
function resolvedParams(value: { id: string }): Promise<{ id: string }> {
  const p = Promise.resolve(value) as Promise<{ id: string }> & { status?: string; value?: unknown };
  p.status = "fulfilled";
  p.value = value;
  return p;
}

beforeEach(() => resetRtl());

const programData = {
  id: 1,
  name: "Robotics Club",
  startAt: "2026-01-10T00:00:00.000Z",
  endAt: "2026-05-10T00:00:00.000Z",
  leadMentorId: 5,
  phase: "RUNNING",
  enrollmentStatus: "OPEN",
  minAge: 10,
  maxAge: 18,
  maxParticipants: 20,
  memberOnly: false,
  participants: [
    {
      personId: 101, status: "ACTIVE", pendingSince: null,
      person: { name: "Alice Kid", email: "alice@example.com", phone: "5125551234" },
    },
    {
      personId: 102, status: "PENDING", pendingSince: "2026-01-06T00:00:00.000Z",
      person: { name: "Charlie Kid", email: "charlie@example.com" },
    },
  ],
  volunteers: [
    { personId: 201, isCore: true, person: { name: "Vera Volunteer", email: "vera@example.com" } },
  ],
  events: [
    { id: 301, name: "Session 1", startAt: "2026-02-01T18:00:00.000Z", endAt: "2026-02-01T20:00:00.000Z", attendanceConfirmedAt: null },
  ],
  leadMentor: { name: "Mandy Mentor", email: "mandy@example.com" },
  memberPriceCents: null,
  nonMemberPriceCents: null,
  shopifyProductId: null,
};

function renderPage() {
  return renderWithProviders(<ProgramDetailsPage params={resolvedParams({ id: "1" })} />);
}

describe("ProgramDetailsPage", () => {
  it("loads and renders the general tab for an authorized admin", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/programs/1": programData });
    renderPage();

    expect(await screen.findByRole("heading", { name: "Robotics Club", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("2 / 20")).toBeInTheDocument();
    expect(screen.getByText("Mandy Mentor (mandy@example.com)")).toBeInTheDocument();
  });

  it("switches to the roster tab and shows volunteers/participants", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/programs/1": programData });
    renderPage();
    await screen.findByRole("heading", { name: "Robotics Club", level: 1 });

    fireEvent.click(screen.getByRole("tab", { name: "Roster" }));
    expect(await screen.findByText(/Vera Volunteer/)).toBeInTheDocument();
    expect(screen.getByText(/Alice Kid/)).toBeInTheDocument();
    expect(screen.getByText(/Charlie Kid/)).toBeInTheDocument();
  });

  it("searches and adds a volunteer", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      "/api/programs/1/eligible-participants": { members: [{ id: 555, name: "Wendy West", email: "wendy@example.com" }] },
      "/api/programs/1/volunteers": {},
      "/api/programs/1": programData,
    });
    renderPage();
    await screen.findByRole("heading", { name: "Robotics Club", level: 1 });
    fireEvent.click(screen.getByRole("tab", { name: "Roster" }));

    const volunteerSearch = (await screen.findAllByPlaceholderText("Start typing to search..."))[0];
    fireEvent.change(volunteerSearch, { target: { value: "Wendy" } });

    expect(await screen.findByText("Wendy West")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Wendy West"));

    const addButtons = screen.getAllByRole("button", { name: "Add" });
    fireEvent.click(addButtons[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/programs/1/volunteers",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ participantId: 555 }) }),
      ),
    );
  });

  it("shows scheduled events on the events tab", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/programs/1": programData });
    renderPage();
    await screen.findByRole("heading", { name: "Robotics Club", level: 1 });

    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(await screen.findByText("Session 1")).toBeInTheDocument();
    // Event ended in the past with no attendanceConfirmedAt -> needs confirmation.
    expect(screen.getByRole("link", { name: "Confirm Attendance" })).toBeInTheDocument();
  });
});
