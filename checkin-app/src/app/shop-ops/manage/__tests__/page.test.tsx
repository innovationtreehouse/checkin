// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import ManageToolsPage from "../page";

beforeEach(() => resetRtl());

describe("ManageToolsPage", () => {
    it("renders the intro copy and the tool management panel", async () => {
        setSession({ id: 1, isSysadmin: true });
        mockFetchJson({
            "/api/shop/tools": [],
            "/api/shop/members": { members: [] },
        });
        renderWithProviders(<ManageToolsPage />);

        expect(screen.getByText(/Browse all tools and safety guides/)).toBeInTheDocument();
        expect(await screen.findByRole("tab", { name: "All Tools" })).toBeInTheDocument();
    });
});
