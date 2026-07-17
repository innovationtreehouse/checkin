/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, fireEvent, waitFor } from "@testing-library/react";

// Reactive next/navigation mock (mirrors src/components/__tests__/StatusFilter.test.tsx):
// router.replace writes back into `search` so a `rerender()` after a click picks up
// the new useSearchParams() value, same as a real app-router navigation would.
let search = "";
const replace = jest.fn((url: string) => {
    search = url.split("?")[1] ?? "";
});
jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace }),
    usePathname: () => "/membership-ops/applications",
    useSearchParams: () => new URLSearchParams(search),
}));
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
import { MantineProvider } from "@mantine/core";
import { EnvProvider } from "@/components/EnvProvider";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { notifications } from "@mantine/notifications";
import AdminMembershipPage from "../page";

// rerender() replaces the whole root, so re-supplying it must mirror renderWithProviders'
// wrapper tree (same component types at each level) or React remounts instead of
// reconciling, losing the page's already-fetched rows state.
const rewrapped = () => (
    <MantineProvider>
        <EnvProvider value={{ checkinEnv: "prod", shopifyStoreDomain: null }}>
            <AdminMembershipPage />
        </EnvProvider>
    </MantineProvider>
);

beforeEach(() => {
    resetRtl();
    (notifications.show as jest.Mock).mockClear();
    search = "";
    replace.mockClear();
});

function household(name: string, id: number) {
    return { name, householdMembers: [{ id: 1, name: "Lead One", email: "lead@example.com", isHouseholdLead: true }], householdId: id };
}

const rows = [
    {
        id: 1,
        kind: "NEW",
        status: "PENDING_EXTERNAL_ACTION",
        createdAt: "2026-01-01T00:00:00.000Z",
        zohoEnvelopeId: null,
        contractSignedAt: null,
        bgConsentAt: null,
        bgClearedAt: null,
        paidAt: null,
        attestations: [],
        orgMembership: { householdId: 1, isVolunteer: false, household: household("Awaiting Family", 1) },
    },
    {
        id: 2,
        kind: "RENEWAL",
        status: "PENDING_PAYMENT",
        createdAt: "2026-01-01T00:00:00.000Z",
        zohoEnvelopeId: "env-1",
        contractSignedAt: "2026-01-02T00:00:00.000Z",
        bgConsentAt: "2026-01-02T00:00:00.000Z",
        bgClearedAt: null,
        paidAt: null,
        attestations: [{ id: 1, result: "APPROVE", isMarkedVolunteer: false }],
        orgMembership: { householdId: 2, isVolunteer: true, household: household("Payment Family", 2) },
    },
    {
        id: 3,
        kind: "NEW",
        status: "BLOCKED",
        createdAt: "2026-01-01T00:00:00.000Z",
        zohoEnvelopeId: "env-3",
        contractSignedAt: "2026-01-02T00:00:00.000Z",
        bgConsentAt: "2026-01-02T00:00:00.000Z",
        bgClearedAt: null,
        paidAt: "2026-01-03T00:00:00.000Z",
        attestations: [],
        orgMembership: { householdId: 3, isVolunteer: false, household: household("Blocked Family", 3) },
    },
];

describe("AdminMembershipPage", () => {
    it("renders in-flight applications and their status counts", async () => {
        mockFetchJson({ "/api/membership-ops/applications": { processes: rows } });
        renderWithProviders(<AdminMembershipPage />);

        expect(await screen.findByText("Awaiting Family")).toBeInTheDocument();
        expect(screen.getByText("Payment Family")).toBeInTheDocument();
        expect(screen.getByText("Blocked Family")).toBeInTheDocument();
        expect(screen.getByText(/1 application\(s\) blocked/)).toBeInTheDocument();
        expect(screen.getByText(/This household already paid/)).toBeInTheDocument();
    });

    it("shows an empty state when there are no in-flight applications", async () => {
        mockFetchJson({ "/api/membership-ops/applications": { processes: [] } });
        renderWithProviders(<AdminMembershipPage />);
        expect(await screen.findByText("No in-flight membership applications.")).toBeInTheDocument();
    });

    it("drives the external-action, certify, and override controls", async () => {
        mockFetchJson({
            "/api/membership-ops/applications": { processes: rows },
            "/api/membership-ops/applications/external": { ok: true },
            "/api/membership-ops/applications/certify-payment": { ok: true },
            "/api/membership-ops/applications/review-override": { ok: true },
        });
        renderWithProviders(<AdminMembershipPage />);
        await screen.findByText("Awaiting Family");

        fireEvent.click(screen.getByRole("button", { name: "Confirm contract signed" }));
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Updated." })));

        fireEvent.click(screen.getByRole("button", { name: "Confirm BG consent" }));
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Updated." })));

        fireEvent.click(screen.getByRole("button", { name: /Certify payment plan/ }));
        // Mantine's `required` prop appends a visible " *" to the label text.
        const certifyReasonInput = await screen.findByLabelText(/^Reason/);
        // The confirm button is disabled until a reason is entered.
        expect(screen.getByRole("button", { name: "Certify" })).toBeDisabled();
        fireEvent.change(certifyReasonInput, { target: { value: "Paid by check outside Shopify" } });
        fireEvent.click(screen.getByRole("button", { name: "Certify" }));
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Certified — membership activated." })));

        fireEvent.click(screen.getByRole("button", { name: "Reset for re-review" }));
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Sent back for re-review." })));

        fireEvent.click(screen.getByRole("button", { name: /Override/ }));
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Overridden to payment." })));
    });

    it("clicking a legend badge narrows the list to that status; clicking again restores it", async () => {
        mockFetchJson({ "/api/membership-ops/applications": { processes: rows } });
        const { rerender } = renderWithProviders(<AdminMembershipPage />);
        await screen.findByText("Awaiting Family");

        fireEvent.click(screen.getByRole("button", { name: "PENDING PAYMENT: 1" }));
        rerender(rewrapped());

        expect(screen.queryByText("Awaiting Family")).not.toBeInTheDocument();
        expect(screen.queryByText("Blocked Family")).not.toBeInTheDocument();
        expect(screen.getByText("Payment Family")).toBeInTheDocument();
        expect(screen.getByText(/Showing only/)).toBeInTheDocument();
        // counts stay computed from all rows while filtered
        expect(screen.getByText("PENDING EXTERNAL ACTION: 1")).toBeInTheDocument();
        expect(screen.getByText("BLOCKED: 1")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "PENDING PAYMENT: 1" }));
        rerender(rewrapped());

        expect(screen.getByText("Awaiting Family")).toBeInTheDocument();
        expect(screen.getByText("Blocked Family")).toBeInTheDocument();
        expect(screen.getByText("Payment Family")).toBeInTheDocument();
        expect(screen.queryByText(/Showing only/)).not.toBeInTheDocument();
    });

    it("shows a clear-filter empty state when the active status has no matching rows", async () => {
        search = "status=PENDING_BG_REVIEW";
        mockFetchJson({ "/api/membership-ops/applications": { processes: rows } });
        renderWithProviders(<AdminMembershipPage />);

        expect(await screen.findByText(/No applications in PENDING BG REVIEW/)).toBeInTheDocument();
        expect(screen.queryByText("Awaiting Family")).not.toBeInTheDocument();

        // Two "Clear filter" actions are visible here: the ActiveFilterNotice and the
        // empty-state card's own clear button. Either should reset the same param.
        fireEvent.click(screen.getAllByRole("button", { name: "Clear filter" })[0]);
        await waitFor(() => expect(replace).toHaveBeenCalledWith("/membership-ops/applications", { scroll: false }));
    });
});
