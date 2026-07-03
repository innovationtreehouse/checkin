/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, fireEvent, waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import { notifications } from "@mantine/notifications";
import ProfilePage from "../page";

beforeEach(() => { resetRtl(); (notifications.show as jest.Mock).mockClear(); });

describe("ProfilePage", () => {
    it("loads an adult's profile and saves an edit", async () => {
        setSession({ id: 1 });
        const fetchMock = mockFetchJson({
            "/api/profile": { profile: { name: "Jamie Adult", email: "jamie@example.com", phone: "555-1111", dateOfBirth: "1990-01-01" } },
        });
        renderWithProviders(<ProfilePage />);

        // "required" adds a visually-hidden "*" to the label text, so match by substring.
        const nameInput = await screen.findByLabelText(/Full Name/);
        expect(nameInput).toHaveValue("Jamie Adult");
        expect(nameInput).not.toBeDisabled();

        fireEvent.change(nameInput, { target: { value: "Jamie Updated" } });
        fireEvent.click(screen.getByRole("button", { name: "Save Profile" }));

        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Profile updated successfully!" })));
        expect(fetchMock).toHaveBeenCalledWith("/api/profile", expect.objectContaining({ method: "PATCH" }));
    });

    it("locks the form as read-only for a youth", async () => {
        setSession({ id: 2 });
        mockFetchJson({
            "/api/profile": { profile: { name: "Kid One", email: "kid@example.com", phone: "555-2222", dateOfBirth: "2020-01-01" } },
        });
        renderWithProviders(<ProfilePage />);

        expect(await screen.findByLabelText(/Full Name/)).toBeDisabled();
        expect(screen.queryByRole("button", { name: "Save Profile" })).not.toBeInTheDocument();
    });
});
