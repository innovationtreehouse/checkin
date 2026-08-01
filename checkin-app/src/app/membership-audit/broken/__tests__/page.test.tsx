// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import BrokenHouseholdsPage from "../page";

beforeEach(() => resetRtl());

describe("membership-audit/broken page", () => {
  it("shows the empty state when there are no broken households", async () => {
    mockFetchJson({ "/api/admin/broken-households": { households: [] } });
    renderWithProviders(<BrokenHouseholdsPage />);

    expect(await screen.findByText("No broken households.")).toBeInTheDocument();
  });

  it("shows an error state (not a false all-clear) when the load fails", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn(() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    renderWithProviders(<BrokenHouseholdsPage />);

    expect(await screen.findByText("Couldn't load broken households.")).toBeInTheDocument();
    expect(screen.queryByText("No broken households.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    spy.mockRestore();
  });
});
