// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl, router } from "@/test-helpers/rtl";
import AdminHouseholdsPage from "../page";

beforeEach(() => resetRtl());

const households = {
  households: [
    {
      id: 1,
      name: "The Smiths",
      membership: { status: "ACTIVE" },
      householdMembers: [{ id: 10, name: "Pat Smith", email: "pat@example.com", isBoardMember: false }],
    },
    {
      id: 2,
      name: "The Joneses",
      membership: null,
      householdMembers: [{ id: 20, name: "Jo Jones", email: "jo@example.com", isBoardMember: false }],
    },
  ],
};

describe("membership-ops/households page", () => {
  it("loads and renders households with membership status", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/membership-ops/households": households });
    renderWithProviders(<AdminHouseholdsPage />);

    expect(await screen.findByText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("The Joneses")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
    expect(screen.getByText("No")).toBeInTheDocument();
  });

  it("filters households by name", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/membership-ops/households": households });
    renderWithProviders(<AdminHouseholdsPage />);
    await screen.findByText("The Smiths");

    fireEvent.change(screen.getByPlaceholderText("Filter by household or participant name/email"), {
      target: { value: "Jones" },
    });

    expect(screen.queryByText("The Smiths")).not.toBeInTheDocument();
    expect(screen.getByText("The Joneses")).toBeInTheDocument();
  });

  it("revokes an active membership", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      "/api/membership-ops/households": households,
    });
    renderWithProviders(<AdminHouseholdsPage />);
    await screen.findByText("The Smiths");

    fireEvent.click(screen.getByRole("button", { name: "Revoke Membership" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/membership-ops/households",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ householdId: 1, active: false }),
        }),
      ),
    );
  });

  it("navigates to the add-participant page for a household", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/membership-ops/households": households });
    renderWithProviders(<AdminHouseholdsPage />);
    await screen.findByText("The Smiths");

    fireEvent.click(screen.getAllByRole("button", { name: "+ Add Participant" })[0]);

    expect(router.push).toHaveBeenCalledWith("/membership-ops/participants/new?householdId=1");
  });
});
