// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import MembershipSettingsPage from "../page";

const SETTINGS = {
  normalDuesCents: 15000,
  volunteerDuesCents: 5000,
  membershipYearBoundary: "2025-09-01T00:00:00.000Z",
  membershipVariantId: "123456",
  volunteerDiscountCode: "VOLUNTEER",
  bgRecheckMonths: 24,
};

beforeEach(() => resetRtl());

describe("MembershipSettingsPage", () => {
  it("loads and renders the current settings", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/settings/membership": { settings: SETTINGS } });
    renderWithProviders(<MembershipSettingsPage />);

    expect(await screen.findByDisplayValue("150.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("50.00")).toBeInTheDocument();
    expect(screen.getByDisplayValue("123456")).toBeInTheDocument();
    expect(screen.getByDisplayValue("VOLUNTEER")).toBeInTheDocument();
  });

  it("edits a field and saves, PUTting the updated value", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/settings/membership": { settings: SETTINGS } });
    renderWithProviders(<MembershipSettingsPage />);

    const normalDues = await screen.findByDisplayValue("150.00");
    fireEvent.change(normalDues, { target: { value: "200.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/settings/membership", expect.objectContaining({ method: "PUT" }));
    });
    const [, putOpts] = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PUT")!;
    expect(JSON.parse(putOpts!.body as string)).toEqual(expect.objectContaining({ normalDuesCents: 20000 }));

    expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
  });
});
