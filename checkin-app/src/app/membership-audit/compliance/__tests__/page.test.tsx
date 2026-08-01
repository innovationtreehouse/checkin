import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { pinTimezone } from "@/test-helpers/tz";
import CompliancePage from "../page";

beforeEach(() => resetRtl());

describe("membership-audit/compliance page", () => {
  pinTimezone();

  it("renders a UTC-midnight lastBackgroundCheck as its own calendar day, not the day before", async () => {
    mockFetchJson({
      "/api/membership-audit/compliance": {
        households: [{ id: 1, name: "The Days", reasons: ["STALE_BG"], lastBackgroundCheck: "2024-08-15T00:00:00.000Z", leads: [] }],
      },
    });
    const { container } = renderWithProviders(<CompliancePage />);
    await screen.findByText("The Days");

    expect(container.textContent).toContain("8/15/2024");
    expect(container.textContent).not.toContain("8/14/2024");
  });

  it("renders the everyone-in-compliance empty state", async () => {
    mockFetchJson({ "/api/membership-audit/compliance": {} });
    renderWithProviders(<CompliancePage />);

    expect(await screen.findByText(/Everyone is in compliance/)).toBeInTheDocument();
  });

  it("renders the network-error alert when the fetch rejects", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn(() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    renderWithProviders(<CompliancePage />);

    expect(await screen.findByText("Network error loading compliance data.")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Failed to load"), expect.anything());
    spy.mockRestore();
  });
});
