import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import CompliancePage from "../page";

beforeEach(() => resetRtl());

describe("membership-audit/compliance page", () => {
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
