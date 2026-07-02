/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, fireEvent, waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import CommunicationPage from "../page";

beforeEach(() => resetRtl());

describe("CommunicationPage", () => {
    it("loads current settings and persists a toggle", async () => {
        setSession({ id: 1, email: "a@example.com" });
        const fetchMock = mockFetchJson({
            "/api/profile": { profile: { notificationSettings: { emailNewsletter: true } } },
        });
        renderWithProviders(<CommunicationPage />);

        const newsletter = await screen.findByLabelText("Subscribe to the monthly newsletter");
        expect(newsletter).toBeChecked();

        fireEvent.click(newsletter);
        await waitFor(() => expect(newsletter).not.toBeChecked());
        expect(fetchMock).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH" }));
    });

    it("disables every toggle when the user has no email on file", async () => {
        setSession({ id: 1, email: null });
        mockFetchJson({ "/api/profile": { profile: { notificationSettings: {} } } });
        renderWithProviders(<CommunicationPage />);

        expect(await screen.findByLabelText("Subscribe to the monthly newsletter")).toBeDisabled();
    });
});
