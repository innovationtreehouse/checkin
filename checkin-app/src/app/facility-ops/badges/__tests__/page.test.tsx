// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl, router } from "@/test-helpers/rtl";
import AdminBadgesPage from "../page";

beforeEach(() => resetRtl());

describe("facility-ops/badges page", () => {
  it("loads and renders badge scan events", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/facility/badges": {
        badges: [{ id: 1, timestamp: "2026-01-01T14:00:00.000Z", person: { name: "Val Volunteer", email: "val@example.com" }, location: "Side Door" }],
      },
    });
    renderWithProviders(<AdminBadgesPage />);

    expect(await screen.findByText("Val Volunteer")).toBeInTheDocument();
    expect(screen.getByText("val@example.com")).toBeInTheDocument();
    expect(screen.getByText("Side Door")).toBeInTheDocument();
  });

  it("admits an operations user", async () => {
    setSession({ id: 5, isOperations: true });
    mockFetchJson({
      "/api/facility/badges": {
        badges: [{ id: 1, timestamp: "2026-01-01T14:00:00.000Z", person: { name: "Val Volunteer", email: "val@example.com" }, location: "Side Door" }],
      },
    });
    renderWithProviders(<AdminBadgesPage />);

    expect(await screen.findByText("Val Volunteer")).toBeInTheDocument();
  });

  // The layout gate and GET /api/facility/badges both admit board, and
  // useRequireRole has no implicit fallthrough — omitting isBoardMember here
  // bounced a board member off a page the API serves them.
  it("admits a board member (matches the layout gate and the API)", async () => {
    setSession({ id: 3, isBoardMember: true });
    mockFetchJson({
      "/api/facility/badges": {
        badges: [{ id: 1, timestamp: "2026-01-01T14:00:00.000Z", person: { name: "Val Volunteer", email: "val@example.com" }, location: "Side Door" }],
      },
    });
    renderWithProviders(<AdminBadgesPage />);

    expect(await screen.findByText("Val Volunteer")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows an error message when the fetch fails", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({});
    renderWithProviders(<AdminBadgesPage />);

    expect(await screen.findByText("Failed to load badge events.")).toBeInTheDocument();
  });
});
