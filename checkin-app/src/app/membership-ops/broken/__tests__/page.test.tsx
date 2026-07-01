// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import BrokenHouseholdsPage from "../page";

beforeEach(() => resetRtl());

const households = {
  households: [
    {
      id: 1,
      name: "The Smiths",
      members: [
        { id: 10, name: "Pat Smith", dateOfBirth: "1980-01-01" },
        { id: 11, name: "Kid Smith", dateOfBirth: "2015-01-01" },
      ],
    },
  ],
};

describe("membership-ops/broken page", () => {
  it("loads and renders broken households, hiding the promote button for minors", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/admin/broken-households": households });
    renderWithProviders(<BrokenHouseholdsPage />);

    expect(await screen.findByText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("Pat Smith", { exact: false })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make Lead" })).toBeInTheDocument();
  });

  it("assigns a lead and refetches", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      "/api/admin/broken-households": households,
      "/api/household/lead": { ok: true },
    });
    renderWithProviders(<BrokenHouseholdsPage />);
    await screen.findByText("The Smiths");

    fireEvent.click(screen.getByRole("button", { name: "Make Lead" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/household/lead",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ participantId: 10 }) }),
      ),
    );
  });

  it("shows the empty state when there are no broken households", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/admin/broken-households": { households: [] } });
    renderWithProviders(<BrokenHouseholdsPage />);

    expect(await screen.findByText("No broken households.")).toBeInTheDocument();
  });
});
