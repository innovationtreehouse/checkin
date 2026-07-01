// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import LocalizationSettingsPage from "../page";

beforeEach(() => resetRtl());

describe("LocalizationSettingsPage", () => {
    it("loads current settings and saves an update", async () => {
        setSession({ id: 1, isSysadmin: true });
        mockFetchJson({
            "/api/admin/settings/localization": { settings: { timezone: "America/Chicago", locale: "en-US" } },
        });
        renderWithProviders(<LocalizationSettingsPage />);

        const saveButton = await screen.findByRole("button", { name: /save settings/i });
        fireEvent.click(saveButton);

        expect(await screen.findByText("Settings saved.")).toBeInTheDocument();
    });
});
