/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, mockFetchJson, setSession, router, resetRtl } from "@/test-helpers/rtl";
import TrustedAdultsPage from "../page";

beforeEach(() => resetRtl());

describe("TrustedAdultsPage", () => {
    it("shows the household lead's trusted adults", async () => {
        setSession({ id: 1, householdLead: true });
        mockFetchJson({
            "/api/trusted-adults/mine": {
                trustedAdults: [
                    { id: 1, trustedAdultName: "Aunt Jo", trustedAdultPhone: null, trustedAdultEmail: null, familyContext: "Pickup", createdAt: "2026-01-01", reviews: [] },
                ],
            },
        });
        renderWithProviders(<TrustedAdultsPage />);

        expect(await screen.findByText("Aunt Jo")).toBeInTheDocument();
        expect(screen.getByText("Awaiting board review")).toBeInTheDocument();
    });

    it("redirects a non-household-lead away", async () => {
        setSession({ id: 2, householdLead: false });
        renderWithProviders(<TrustedAdultsPage />);
        await waitFor(() => expect(router.push).toHaveBeenCalledWith("/"));
        expect(screen.queryByText("Trusted Adults")).not.toBeInTheDocument();
    });
});
