// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import VolunteerMembershipsPage from "../page";

beforeEach(() => resetRtl());

const designations = { designations: [{ id: 1, email: "vol@example.com", createdAt: "2026-01-01" }] };

describe("membership-ops/volunteer-memberships page", () => {
  it("loads and renders designated emails", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/settings/membership/volunteer-designations": designations });
    renderWithProviders(<VolunteerMembershipsPage />);

    expect(await screen.findByText("vol@example.com")).toBeInTheDocument();
  });

  it("shows the empty state when there are no designations", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/settings/membership/volunteer-designations": { designations: [] } });
    renderWithProviders(<VolunteerMembershipsPage />);

    expect(await screen.findByText("No volunteer designations yet.")).toBeInTheDocument();
  });

  it("adds a new designation", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({
      "/api/settings/membership/volunteer-designations": () => designations,
    });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("vol@example.com");

    fireEvent.change(screen.getByPlaceholderText("volunteer@example.com"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/membership/volunteer-designations",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "new@example.com" }) }),
      ),
    );
  });

  it("removes a designation", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/settings/membership/volunteer-designations": designations });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("vol@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/settings/membership/volunteer-designations?id=1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
