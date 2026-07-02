/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, fireEvent, waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import ParticipantEventsDashboard from "../page";

beforeEach(() => resetRtl());

describe("ParticipantEventsDashboard", () => {
    it("groups event rows by event and RSVPs", async () => {
        setSession({ id: 1, householdLead: true });
        const fetchMock = mockFetchJson({
            "/api/events/mine": [
                { id: 10, name: "Robotics Meet", description: null, startAt: "2026-07-10T18:00:00.000Z", endAt: "2026-07-10T20:00:00.000Z", program: { name: "Robotics Club" }, participant: { id: 100, name: "Kid One" }, rsvp: null },
            ],
        });
        renderWithProviders(<ParticipantEventsDashboard />);

        expect(await screen.findByText("Robotics Meet")).toBeInTheDocument();
        expect(screen.getByText("Kid One")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Yes" }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/events/10/rsvp", expect.objectContaining({ method: "PATCH" })));
    });

    it("shows an empty state with no upcoming events", async () => {
        setSession({ id: 1 });
        mockFetchJson({ "/api/events/mine": [] });
        renderWithProviders(<ParticipantEventsDashboard />);
        expect(await screen.findByText("No Upcoming Events")).toBeInTheDocument();
    });
});
