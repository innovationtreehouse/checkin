// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import CreateToolPage from "../page";

beforeEach(() => resetRtl());

describe("CreateToolPage", () => {
    it("lists existing tools and creates a new one", async () => {
        mockFetchJson({ "/api/shop/tools": [{ id: 1, name: "Table Saw", safetyGuide: null }] });
        renderWithProviders(<CreateToolPage />);

        expect(await screen.findByText("Table Saw")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText(/equipment name/i), { target: { value: "Band Saw" } });
        fireEvent.click(screen.getByRole("button", { name: /create tool/i }));

        expect(await screen.findByText("New tool added successfully!")).toBeInTheDocument();
    });
});
