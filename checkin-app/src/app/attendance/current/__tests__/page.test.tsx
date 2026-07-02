// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import KioskDisplay from "../page";

beforeEach(() => resetRtl());

const attendanceData = {
  access: "full",
  attendance: [
    { id: 201, arrivedAt: "2026-07-01T14:00:00.000Z", participant: { id: 50, email: "karen@example.com", name: "Karen Keyholder", isKeyholder: true, isSysadmin: false, dateOfBirth: "1985-01-01", householdId: 6 } },
    { id: 202, arrivedAt: "2026-07-01T14:05:00.000Z", participant: { id: 60, email: "val@example.com", name: "Val Volunteer", isKeyholder: false, isSysadmin: false, dateOfBirth: "1990-01-01", householdId: 7 } },
    { id: 203, arrivedAt: "2026-07-01T14:10:00.000Z", participant: { id: 70, email: "stu@example.com", name: "Stu Student", isKeyholder: false, isSysadmin: false, dateOfBirth: "2012-01-01", householdId: 8 } },
  ],
  counts: { keyholders: 1, volunteers: 1, youth: 1, total: 3 },
  safety: { isLastKeyholder: false, isTwoDeepViolation: false },
};

const householdData = {
  household: {
    leads: [{ participantId: 1 }],
    participants: [{ id: 90, name: "Jamie Kid", email: "jamie@example.com" }],
  },
};

function mockRoutes(overrides: Record<string, unknown | (() => unknown)> = {}) {
  return mockFetchJson({
    "/api/household": householdData,
    "/api/roles": { participants: [{ id: 555, name: "Wendy West", email: "wendy@example.com", isKeyholder: false, isSysadmin: false }] },
    "/api/attendance": attendanceData,
    ...overrides,
  });
}

// The admin (id 1, sysadmin + keyholder) is not checked in and has a household,
// so both the self check-in button and the household check-in row render.
function setAdminSession() {
  setSession({ id: 1, isSysadmin: true, isKeyholder: true, householdId: 5 });
}

describe("attendance/current page", () => {
  it("loads and renders the attendance columns", async () => {
    setAdminSession();
    mockRoutes();
    renderWithProviders(<KioskDisplay />);

    expect(await screen.findByText("3 People Present")).toBeInTheDocument();
    expect(screen.getByText("Karen Keyholder")).toBeInTheDocument();
    expect(screen.getByText("Val Volunteer")).toBeInTheDocument();
    expect(screen.getByText("Stu Student")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Check Me In" })).toBeInTheDocument();
  });

  it("checks the current admin in", async () => {
    setAdminSession();
    const fetchMock = mockRoutes();
    renderWithProviders(<KioskDisplay />);
    await screen.findByText("3 People Present");

    fireEvent.click(screen.getByRole("button", { name: "Check Me In" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/attendance",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "MANUAL_CHECKIN", participantId: 1 }),
        }),
      ),
    );
  });

  it("checks in a household member from the household row", async () => {
    setAdminSession();
    const fetchMock = mockRoutes();
    renderWithProviders(<KioskDisplay />);
    await screen.findByText("3 People Present");

    expect(await screen.findByText("Check In Household Members")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Jamie Kid" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/attendance",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "MANUAL_CHECKIN", participantId: 90 }),
        }),
      ),
    );
  });

  it("searches and manually checks in a match", async () => {
    setAdminSession();
    const fetchMock = mockRoutes();
    renderWithProviders(<KioskDisplay />);
    await screen.findByText("3 People Present");

    fireEvent.change(screen.getByPlaceholderText("Manually check someone in (Search by name or email)..."), {
      target: { value: "Wendy" },
    });

    expect(await screen.findByText("Wendy West")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Check In" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/attendance",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ type: "MANUAL_CHECKIN", participantId: 555 }),
        }),
      ),
    );
  });

  it("force-checks-out a user via the sign-out modal", async () => {
    window.confirm = jest.fn(() => true);
    setAdminSession();
    const fetchMock = mockRoutes();
    renderWithProviders(<KioskDisplay />);
    await screen.findByText("3 People Present");

    fireEvent.click(screen.getByRole("button", { name: "Sign out a user" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("Val Volunteer")).toBeInTheDocument();
    // Rows are sorted alphabetically: Karen, Stu, Val -> Val is the 3rd "Sign Out" button.
    const signOutButtons = within(modal).getAllByRole("button", { name: "Sign Out" });
    fireEvent.click(signOutButtons[2]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/attendance",
        expect.objectContaining({ method: "DELETE", body: JSON.stringify({ visitId: 202 }) }),
      ),
    );
  });
});
