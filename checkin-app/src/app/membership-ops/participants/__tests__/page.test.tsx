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
    household: { id: 20, name: "The B Family", householdMembers: [{ id: 2, name: "Bob B", email: null }, { id: 3, name: "Sis B", email: "sis@example.com" }] },
};
const carol = { id: 3, name: "Carol C", email: null, phone: null, household: null };
const dave = {
    id: 4,
    name: "Dave D",
    email: "dave@example.com",
    phone: null,
    household: { id: 30, name: "Dave Household", householdMembers: [{ id: 4, name: "Dave D", email: "dave@example.com" }] },
};

describe("AdminParticipantsIndex", () => {
    it("searches, sorts, and edits a participant's details", async () => {
        mockFetchJson({
            "/api/people/search": { people: [alice, bob] },
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

        expect(await screen.findByText("Edit Person")).toBeInTheDocument();
        const emailInput = screen.getByLabelText("Email Address");
        fireEvent.change(emailInput, { target: { value: "alice@new.com" } });
        fireEvent.click(screen.getByRole("button", { name: "Save Details" }));

        await waitFor(() => expect(screen.queryByText("Edit Person")).not.toBeInTheDocument());
        expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Person updated successfully!" }));
    });

    it("assigns a new household to a participant with none", async () => {
        mockFetchJson({
            "/api/people/search": { people: [carol] },
            "/api/membership-ops/participants/3/household": {
                participant: { ...carol, household: { id: 50, name: "Carol Household", householdMembers: [{ id: 3, name: "Carol C", email: null }] } },
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

    it("sorts by the household and email columns, and toggles direction back to ascending", async () => {
        mockFetchJson({ "/api/people/search": { people: [alice, bob] } });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Alice A")).toBeInTheDocument();

        const headers = screen.getAllByRole("columnheader");
        fireEvent.click(within(headers[3]).getByRole("button")); // Household asc
        fireEvent.click(within(headers[3]).getByRole("button")); // Household desc
        fireEvent.click(within(headers[2]).getByRole("button")); // Email

        fireEvent.click(within(headers[1]).getByRole("button")); // Name asc (was id)
        fireEvent.click(within(headers[1]).getByRole("button")); // Name desc
        fireEvent.click(within(headers[1]).getByRole("button")); // Name asc again

        expect(screen.getByText("Bob B")).toBeInTheDocument();
    });

    it("shows an empty state when the search returns no participants", async () => {
        mockFetchJson({});
        renderWithProviders(<AdminParticipantsIndex />);
        expect(screen.queryByText("No people found.")).not.toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "zzz" } });
        expect(await screen.findByText("No people found.")).toBeInTheDocument();
    });

    it("recovers from a network error while searching", async () => {
        const errSpy = jest.spyOn(console, "error").mockImplementation(() => {});
        global.fetch = jest.fn().mockRejectedValue(new Error("boom"));
        renderWithProviders(<AdminParticipantsIndex />);
        await waitFor(() => expect(errSpy).toHaveBeenCalled());
        expect(screen.getByPlaceholderText("Search by name or email...")).toBeInTheDocument();
        errSpy.mockRestore();
    });

    it("pulls a participant from an existing household into a new one via the confirm step", async () => {
        mockFetchJson({
            "/api/people/search": { people: [bob] },
            "/api/membership-ops/participants/2/household": { participant: { ...bob, household: null } },
        });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Bob B")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Details" }));
        expect(await screen.findByText("Edit Person")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Move to Another Household" }));

        expect(await screen.findByText("Assign Household to Bob B")).toBeInTheDocument();
        expect(screen.getByText(/Current Household: The B Family/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Pull from household and start a new one" }));
        expect(await screen.findByText("Are you sure?")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Go Back" }));
        expect(screen.queryByText("Are you sure?")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Pull from household and start a new one" }));
        expect(await screen.findByText("Are you sure?")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Yes, Proceed" }));

        await waitFor(() => expect(screen.queryByText("Assign Household to Bob B")).not.toBeInTheDocument());
        expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Household assigned successfully!" }));
    });

    it("changes a single-member household by searching and selecting a new one via EntityPicker", async () => {
        mockFetchJson({
            "/api/people/search": { people: [dave] },
            "/api/membership-ops/households?q=": { households: [{ id: 99, name: "New Fam", householdMembers: [{ id: 50, name: "Existing Member", email: null }] }] },
            "/api/membership-ops/participants/4/household": {
                participant: { ...dave, household: { id: 99, name: "New Fam", householdMembers: [{ id: 50, name: "Existing Member", email: null }, { id: 4, name: "Dave D", email: "dave@example.com" }] } },
            },
        });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Dave D")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Details" }));
        fireEvent.click(await screen.findByRole("button", { name: "Move to Another Household" }));
        expect(await screen.findByText("Assign Household to Dave D")).toBeInTheDocument();

        // A lone member's household can't be "pulled from" (nothing left behind).
        expect(screen.queryByRole("button", { name: /Pull from household/ })).not.toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("Search households..."), { target: { value: "New" } });
        expect(await screen.findByText("New Fam")).toBeInTheDocument();
        fireEvent.click(screen.getByText("New Fam"));

        // Clear the selection and re-pick it to also exercise EntityPicker's onClear.
        fireEvent.click(screen.getByRole("button", { name: "Clear" }));
        fireEvent.change(screen.getByPlaceholderText("Search households..."), { target: { value: "New" } });
        expect(await screen.findByText("New Fam")).toBeInTheDocument();
        fireEvent.click(screen.getByText("New Fam"));

        fireEvent.click(screen.getByRole("button", { name: "Change Household" }));
        await waitFor(() => expect(screen.queryByText("Assign Household to Dave D")).not.toBeInTheDocument());
        expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Household assigned successfully!" }));
    });

    it("surfaces a server error message when assigning a household fails", async () => {
        mockFetchJson({ "/api/people/search": { people: [carol] } });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Carol C")).toBeInTheDocument();

        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/people/search")) return { ok: true, status: 200, json: async () => ({ people: [carol] }) } as Response;
            return { ok: false, status: 400, json: async () => ({ error: "Household is full" }) } as Response;
        });

        fireEvent.click(screen.getByRole("button", { name: "Assign" }));
        fireEvent.click(await screen.findByRole("button", { name: "Create New Household" }));
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Household is full", color: "red" })),
        );
    });

    it("shows a network-error notification when assigning a household throws", async () => {
        mockFetchJson({ "/api/people/search": { people: [carol] } });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Carol C")).toBeInTheDocument();

        global.fetch = jest.fn().mockRejectedValue(new Error("down"));
        fireEvent.click(screen.getByRole("button", { name: "Assign" }));
        fireEvent.click(await screen.findByRole("button", { name: "Create New Household" }));
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Network error", color: "red" })),
        );
    });

    it("surfaces an error and a network-error notification when saving participant details fails", async () => {
        mockFetchJson({ "/api/people/search": { people: [alice] } });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Alice A")).toBeInTheDocument();

        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/people/search")) return { ok: true, status: 200, json: async () => ({ people: [alice] }) } as Response;
            return { ok: false, status: 400, json: async () => ({ error: "Email already in use" }) } as Response;
        });
        fireEvent.click(screen.getByRole("button", { name: "Details" }));
        fireEvent.click(await screen.findByRole("button", { name: "Save Details" }));
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Email already in use", color: "red" })),
        );
        expect(screen.getByText("Edit Person")).toBeInTheDocument();

        global.fetch = jest.fn().mockRejectedValue(new Error("down"));
        fireEvent.click(screen.getByRole("button", { name: "Save Details" }));
        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Network error", color: "red" })),
        );
    });

    it("cancels out of the edit participant modal", async () => {
        mockFetchJson({ "/api/people/search": { people: [alice] } });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Alice A")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Details" }));
        expect(await screen.findByText("Edit Person")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByText("Edit Person")).not.toBeInTheDocument());
    });

    it("opens Edit Household Info from a row's Household button and saves via the admin household modal", async () => {
        mockFetchJson({ "/api/people/search": { people: [bob] } });
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/people/search")) return { ok: true, status: 200, json: async () => ({ people: [bob] }) } as Response;
            if (url.includes("/api/membership-ops/households?id=20")) {
                return {
                    ok: true, status: 200,
                    json: async () => ({ household: { id: 20, name: "The B Family", emergencyContactName: null, emergencyContactPhone: null, householdMembers: bob.household!.householdMembers, householdLeads: [] } }),
                } as Response;
            }
            if (url.includes("/api/membership-ops/households/20")) {
                return { ok: true, status: 200, json: async () => ({ household: { id: 20, name: "The B Family Updated" } }) } as Response;
            }
            return { ok: false, status: 404, json: async () => ({}) } as Response;
        });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Bob B")).toBeInTheDocument();

        const bobRow = screen.getByText("Bob B").closest("tr")!;
        fireEvent.click(within(bobRow).getByRole("button", { name: "Household" }));
        expect(await screen.findByText(/Edit Household Info/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
        expect(await screen.findByText("Use admin powers?")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Yes, save changes" }));

        await waitFor(() => expect(screen.queryByText("Use admin powers?")).not.toBeInTheDocument());
        expect(await screen.findByText("The B Family Updated")).toBeInTheDocument();
    });

    it("opens Edit Household Info from the details modal's household sub-action", async () => {
        mockFetchJson({ "/api/people/search": { people: [bob] } });
        global.fetch = jest.fn(async (input: RequestInfo | URL) => {
            const url = typeof input === "string" ? input : input.toString();
            if (url.includes("/api/people/search")) return { ok: true, status: 200, json: async () => ({ people: [bob] }) } as Response;
            if (url.includes("/api/membership-ops/households?id=20")) {
                return { ok: true, status: 200, json: async () => ({ household: { id: 20, name: "The B Family", householdMembers: bob.household!.householdMembers } }) } as Response;
            }
            return { ok: false, status: 404, json: async () => ({}) } as Response;
        });
        renderWithProviders(<AdminParticipantsIndex />);
        expect(await screen.findByText("Bob B")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Details" }));
        expect(await screen.findByText("Edit Person")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Edit Household Info" }));
        expect(await screen.findByText(/Edit Household Info —/)).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText("Edit Person")).not.toBeInTheDocument());
    });
});
