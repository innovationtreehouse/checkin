/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, fireEvent, waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { notifications } from "@mantine/notifications";
import AdminMembershipPage from "../page";

beforeEach(() => { resetRtl(); (notifications.show as jest.Mock).mockClear(); });

function household(name: string, id: number) {
    return { name, householdMembers: [{ id: 1, name: "Lead One", email: "lead@example.com" }], leads: [{ personId: 1 }], householdId: id };
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
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Certified — membership activated." })));

        fireEvent.click(screen.getByRole("button", { name: "Reset for re-review" }));
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Sent back for re-review." })));

        fireEvent.click(screen.getByRole("button", { name: /Override/ }));
        await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Overridden to payment." })));
    });
});
