/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, waitFor, fireEvent, within } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
import { notifications } from "@mantine/notifications";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import AdminParticipantsIndex from "../page";

beforeEach(() => {
    resetRtl();
    (notifications.show as jest.Mock).mockClear();
});

const alice = { id: 1, name: "Alice A", email: "alice@example.com", phone: "555-1111", household: null };
const bob = {
    id: 2,
    name: "Bob B",
    email: null,
    phone: null,
    household: { id: 20, name: "The B Family", participants: [{ id: 2, name: "Bob B", email: null }, { id: 3, name: "Sis B", email: "sis@example.com" }] },
};
const carol = { id: 3, name: "Carol C", email: null, phone: null, household: null };

describe("AdminParticipantsIndex", () => {
    it("searches, sorts, and edits a participant's details", async () => {
        mockFetchJson({
            "/api/participants/search": { participants: [alice, bob] },
            "/api/membership-ops/participants/1": { participant: { id: 1, name: "Alice A", email: "alice@new.com", phone: "555-2222" } },
        });
        renderWithProviders(<AdminParticipantsIndex />);

        expect(await screen.findByText("Alice A")).toBeInTheDocument();
        expect(screen.getByText("Bob B")).toBeInTheDocument();
        expect(screen.getByText("The B Family")).toBeInTheDocument();
        expect(screen.getByText("No email")).toBeInTheDocument();

        // toggle sort by name both directions (this reorders the rows, hence the
        // row lookup by text below rather than a fixed row index)
        fireEvent.click(screen.getByRole("button", { name: /Name/ }));
        fireEvent.click(screen.getByRole("button", { name: /Name/ }));

        fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "ali" } });
        await waitFor(() => expect(screen.getByPlaceholderText("Search by name or email...")).toHaveValue("ali"));

        // Scope to Alice's row rather than a fixed index — the sort toggles above can reorder rows.
        const aliceRow = screen.getByText("Alice A").closest("tr")!;
        fireEvent.click(within(aliceRow).getByRole("button", { name: "Details" }));

        expect(await screen.findByText("Edit Participant")).toBeInTheDocument();
        const emailInput = screen.getByLabelText("Email Address");
        fireEvent.change(emailInput, { target: { value: "alice@new.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Save Details" }));

        await waitFor(() => expect(screen.queryByText("Edit Participant")).not.toBeInTheDocument());
        expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Participant updated successfully!" }));
    });

    it("assigns a new household to a participant with none", async () => {
        mockFetchJson({
            "/api/participants/search": { participants: [carol] },
            "/api/membership-ops/participants/3/household": {
                participant: { ...carol, household: { id: 50, name: "Carol Household", participants: [{ id: 3, name: "Carol C", email: null }] } },
            },
        });
        renderWithProviders(<AdminParticipantsIndex />);

        expect(await screen.findByText("Carol C")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Assign" }));
        expect(await screen.findByText("Assign Household to Carol C")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Create New Household" }));

        await waitFor(() => expect(screen.queryByText("Assign Household to Carol C")).not.toBeInTheDocument());
        expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Household assigned successfully!" }));
    });
});
