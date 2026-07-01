/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import HouseholdCheckins from "../page";

beforeEach(() => resetRtl());

describe("HouseholdCheckins", () => {
    it("shows a loader while the session resolves", () => {
        setSession(null, "loading");
        renderWithProviders(<HouseholdCheckins />);
        expect(screen.queryByText("Household Check-ins")).not.toBeInTheDocument();
    });

    it("lists past visits for the household", async () => {
        setSession({ id: 1 });
        mockFetchJson({
            "/api/household/visits": {
                visits: [
                    { id: 1, participant: { name: "Kid One" }, event: { name: "Open Shop" }, arrivedAt: "2026-06-01T10:00:00.000Z", departedAt: "2026-06-01T11:00:00.000Z" },
                ],
            },
        });
        renderWithProviders(<HouseholdCheckins />);

        expect(await screen.findByText("Kid One")).toBeInTheDocument();
        expect(screen.getByText("Open Shop")).toBeInTheDocument();
    });
});
