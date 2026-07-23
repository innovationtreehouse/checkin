// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, resetRtl } from "@/test-helpers/rtl";
import IndexPage from "../page";

beforeEach(() => resetRtl());

describe("IndexPage", () => {
    it("lists public pages when signed out and filters by search", () => {
        renderWithProviders(<IndexPage />);

        expect(screen.getByRole("link", { name: /programs/i })).toHaveAttribute("href", "/programs");

        fireEvent.change(screen.getByPlaceholderText("Search pages…"), { target: { value: "zzz-no-match" } });
        expect(screen.getByText(/No pages match/)).toBeInTheDocument();
    });
});
