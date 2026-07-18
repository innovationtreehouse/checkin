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
            "/api/profile": { profile: { notificationSettings: { emailCheckinReceipts: true } } },
        });
        renderWithProviders(<CommunicationPage />);

        const receipts = await screen.findByLabelText("Email me when I check in or out");
        expect(receipts).toBeChecked();

        fireEvent.click(receipts);
        await waitFor(() => expect(receipts).not.toBeChecked());
        expect(fetchMock).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH" }));
    });

    it("disables every toggle when the user has no email on file", async () => {
        setSession({ id: 1, email: null });
        mockFetchJson({ "/api/profile": { profile: { notificationSettings: {} } } });
        renderWithProviders(<CommunicationPage />);

        expect(await screen.findByLabelText("Email me when I check in or out")).toBeDisabled();
    });
});
