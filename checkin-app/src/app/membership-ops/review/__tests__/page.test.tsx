// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import MembershipReviewPage from "../page";

beforeEach(() => { resetRtl(); (notifications.show as jest.Mock).mockClear(); });

const queue = {
  queue: [
    {
      id: 100,
      orgMembership: { household: { name: "The Smiths", leads: [{ participant: { id: 1, name: "Pat Smith", email: "pat@example.com" } }] } },
      _count: { attestations: 1 },
    },
  ],
};

describe("membership-ops/review page", () => {
  it("loads and renders the review queue", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/membership/reviews": queue });
    renderWithProviders(<MembershipReviewPage />);

    expect(await screen.findByText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("Pat Smith <pat@example.com>", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("1/2 approvals so far.")).toBeInTheDocument();
  });

  it("approves an attestation", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/membership/reviews": queue });
    renderWithProviders(<MembershipReviewPage />);
    await screen.findByText("The Smiths");

    fireEvent.click(screen.getByRole("button", { name: "Attest — check is clean" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/membership/reviews",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ processId: 100, result: "APPROVE", isMarkedVolunteer: false }),
        }),
      ),
    );
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "green", message: "Attestation recorded — thank you." })));
  });

  it("shows the forbidden card when the queue endpoint returns 403", async () => {
    setSession({ id: 1, isSysadmin: true });
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
    renderWithProviders(<MembershipReviewPage />);

    expect(await screen.findByText("Background-check review")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is queued", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/membership/reviews": { queue: [] } });
    renderWithProviders(<MembershipReviewPage />);

    expect(await screen.findByText("Nothing awaiting your review right now.")).toBeInTheDocument();
  });
});
