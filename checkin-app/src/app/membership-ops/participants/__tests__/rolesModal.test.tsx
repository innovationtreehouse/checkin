// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
jest.mock("@mantine/modals", () => ({ modals: { openConfirmModal: jest.fn() } }));

import { screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { modals } from "@mantine/modals";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import AdminParticipantsIndex from "../page";

beforeEach(() => {
    resetRtl();
    (notifications.show as jest.Mock).mockClear();
    (modals.openConfirmModal as jest.Mock).mockClear();
});

// Jane: keyholder only. Bob: board member only. Distinct active-role sets so
// the pill-cluster and disabled-switch assertions can't cross-match.
const rows = [
    {
        id: 1, name: "Jane Doe", email: "jane@example.com", phone: null, household: null,
        isSysadmin: false, isBoardMember: false, isKeyholder: true, isBackgroundCheckReviewer: false, isOperations: false,
    },
    {
        id: 2, name: "Bob Board", email: "bob@example.com", phone: null, household: null,
        isSysadmin: false, isBoardMember: true, isKeyholder: false, isBackgroundCheckReviewer: false, isOperations: false,
    },
];

describe("AdminParticipantsIndex — roles pills + edit modal", () => {
    it("renders one pill per active role on a row", async () => {
        setSession({ id: 99, isBoardMember: true });
        mockFetchJson({ "/api/people/search": { people: rows } });
        renderWithProviders(<AdminParticipantsIndex />);

        expect(await screen.findByText("Jane Doe")).toBeInTheDocument();
        expect(screen.getByText("Keyholder")).toBeInTheDocument();
        expect(screen.getByText("Board")).toBeInTheDocument();
        expect(screen.queryByText("Sysadmin")).not.toBeInTheDocument();
        expect(screen.queryByText("Operations")).not.toBeInTheDocument();
    });

    it("Edit roles opens a modal with five switches reflecting the row's current flags", async () => {
        setSession({ id: 99, isBoardMember: true });
        mockFetchJson({ "/api/people/search": { people: rows } });
        renderWithProviders(<AdminParticipantsIndex />);
        await screen.findByText("Jane Doe");

        fireEvent.click(screen.getAllByRole("button", { name: "Edit roles" })[0]);

        expect(await screen.findByLabelText("Sysadmin")).not.toBeChecked();
        expect(screen.getByLabelText("Board")).not.toBeChecked();
        expect(screen.getByLabelText("Keyholder")).toBeChecked();
        expect(screen.getByLabelText("BG Reviewer")).not.toBeChecked();
        expect(screen.getByLabelText("Operations")).not.toBeChecked();
    });

    it("board actor: no switch is disabled, even for a target who is already board", async () => {
        setSession({ id: 99, isBoardMember: true });
        mockFetchJson({ "/api/people/search": { people: rows } });
        renderWithProviders(<AdminParticipantsIndex />);
        await screen.findByText("Jane Doe");

        fireEvent.click(screen.getAllByRole("button", { name: "Edit roles" })[1]); // Bob (board:true)
        expect(await screen.findByLabelText("Board")).toBeEnabled();
        expect(screen.getByLabelText("Sysadmin")).toBeEnabled();
    });

    it("sysadmin-only actor: Board switch is disabled only when currently on", async () => {
        setSession({ id: 99, isSysadmin: true });
        mockFetchJson({ "/api/people/search": { people: rows } });
        renderWithProviders(<AdminParticipantsIndex />);
        await screen.findByText("Jane Doe");

        // Jane: board off -> enabled (sysadmin-only may grant it).
        fireEvent.click(screen.getAllByRole("button", { name: "Edit roles" })[0]);
        expect(await screen.findByLabelText("Board")).toBeEnabled();
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

        // Bob: board on -> disabled (sysadmin-only may never remove it).
        fireEvent.click(screen.getAllByRole("button", { name: "Edit roles" })[1]);
        expect(await screen.findByLabelText("Board")).toBeDisabled();
    });

    it("Save with a delta opens a confirm modal restating the delta, PATCHes only the delta, and reverts + toasts on a 409", async () => {
        setSession({ id: 99, isBoardMember: true });
        mockFetchJson({ "/api/people/search": { people: rows } });
        renderWithProviders(<AdminParticipantsIndex />);
        await screen.findByText("Jane Doe");

        fireEvent.click(screen.getAllByRole("button", { name: "Edit roles" })[0]); // Jane
        fireEvent.click(await screen.findByLabelText("Operations")); // grant
        fireEvent.click(screen.getByLabelText("Keyholder")); // revoke (was checked)
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        expect(modals.openConfirmModal).toHaveBeenCalledTimes(1);
        const call = (modals.openConfirmModal as jest.Mock).mock.calls[0][0];
        // Rendered into its own detached container (and unmounted immediately after)
        // so its text doesn't collide with the "Jane Doe" already on the page.
        const { container, unmount } = renderWithProviders(call.children);
        expect(container.textContent).toContain("Grant Operations");
        expect(container.textContent).toContain("Revoke Keyholder");
        expect(container.textContent).toContain("Jane Doe");
        unmount();

        const patchFetch = jest.fn(async () => ({
            ok: false,
            status: 409,
            json: async () => ({ error: "Cannot remove the last board member" }),
        }));
        global.fetch = patchFetch as unknown as typeof fetch;

        // Simulate the user confirming in the (mocked-out) confirm modal.
        await act(async () => {
            await call.onConfirm();
        });

        await waitFor(() => expect(patchFetch).toHaveBeenCalled());
        const [calledUrl, calledInit] = patchFetch.mock.calls[0] as unknown as [string, RequestInit];
        expect(calledUrl).toBe("/api/roles");
        expect(calledInit.method).toBe("PATCH");
        expect(JSON.parse(calledInit.body as string)).toEqual({ targetUserId: 1, isKeyholder: false, isOperations: true });

        await waitFor(() =>
            expect(notifications.show).toHaveBeenCalledWith(
                expect.objectContaining({ color: "red", message: "Cannot remove the last board member" }),
            ),
        );

        // Optimistic update reverted: Jane's row is back to Keyholder-only.
        const janeRow = screen.getByText("Jane Doe").closest("tr")!;
        expect(within(janeRow).getByText("Keyholder")).toBeInTheDocument();
        expect(within(janeRow).queryByText("Operations")).not.toBeInTheDocument();
    });
});
