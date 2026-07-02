// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import HouseholdPage from "../page";

beforeEach(() => resetRtl());

const householdData = {
  id: 55,
  name: "Smith Household",
  leads: [{ participantId: 10 }],
  participants: [
    { id: 10, name: "Sam Smith", email: "sam@example.com", phone: "5125551234", dateOfBirth: "1980-01-01" },
    { id: 11, name: "Jamie Smith", email: "", dateOfBirth: "2012-05-01" },
  ],
  membership: { status: "ACTIVE", memberSince: "2024-01-01T00:00:00.000Z", isVolunteer: false },
  line1: "123 Main St", line2: "", city: "Austin", state: "TX", postalCode: "78701",
};

function mockRoutes(overrides: Record<string, unknown | (() => unknown)> = {}) {
  return mockFetchJson({
    "/api/household/emergency-contacts": { contacts: [] },
    "/api/household/settings": {},
    "/api/household/member": {},
    "/api/household/lead": {},
    "/api/household": { household: householdData },
    ...overrides,
  });
}

describe("HouseholdPage", () => {
  it("loads and renders household members", async () => {
    setSession({ id: 10, email: "sam@example.com" });
    mockRoutes();
    renderWithProviders(<HouseholdPage />);

    expect(await screen.findByRole("heading", { name: "Smith Household", level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Member since/)).toBeInTheDocument();
    expect(screen.getByText("Sam Smith")).toBeInTheDocument();
    expect(screen.getByText("Jamie Smith")).toBeInTheDocument();
    expect(screen.getByText("Household Lead")).toBeInTheDocument();
    expect(screen.getByText("No emergency contact on file. Add at least one.")).toBeInTheDocument();
  });

  it("adds a household member", async () => {
    setSession({ id: 10, email: "sam@example.com" });
    const fetchMock = mockRoutes();
    renderWithProviders(<HouseholdPage />);
    await screen.findByRole("heading", { name: "Smith Household", level: 1 });

    fireEvent.click(screen.getByRole("button", { name: "+ Add Household Member" }));
    fireEvent.change(screen.getByLabelText("Full Name"), { target: { value: "Robin Smith" } });
    fireEvent.click(screen.getByLabelText("Individual is over 25"));
    fireEvent.click(screen.getByRole("button", { name: "Save / Invite Member" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/household",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ memberName: "Robin Smith", memberEmail: "", memberDob: "", memberOver25: true }),
        }),
      ),
    );
  });

  it("saves the household address", async () => {
    setSession({ id: 10, email: "sam@example.com" });
    const fetchMock = mockRoutes();
    renderWithProviders(<HouseholdPage />);
    await screen.findByRole("heading", { name: "Smith Household", level: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Update Address" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/household/settings",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(await screen.findByText("Settings updated successfully!")).toBeInTheDocument();
  });

  it("adds an emergency contact", async () => {
    setSession({ id: 10, email: "sam@example.com" });
    const fetchMock = mockRoutes();
    renderWithProviders(<HouseholdPage />);
    await screen.findByRole("heading", { name: "Smith Household", level: 1 });

    fireEvent.click(screen.getByRole("button", { name: "+ Add Contact" }));
    fireEvent.change(screen.getByLabelText("Contact Name"), { target: { value: "Pat Neighbor" } });
    fireEvent.change(screen.getByLabelText("Phone"), { target: { value: "5125559999" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Contact" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/household/emergency-contacts",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
