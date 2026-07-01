// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import AdminTrustedAdultsPage from "../page";

beforeEach(() => resetRtl());

const trustedAdults = [
  {
    id: 1,
    counterpartyName: "Gary Guardian",
    counterpartyPhone: null,
    counterpartyEmail: null,
    familyContext: "Family friend, watches the kids after school.",
    origin: "SELF_DISCLOSED",
    createdAt: "2026-01-01T00:00:00.000Z",
    household: { id: 5, name: "Guardian House", leads: [] },
    counterparty: null,
    reviews: [{ id: 9, kind: "SELF_DISCLOSED", status: "PENDING_BOARD_REVIEW", decision: null, decisionNote: null, sharedNote: null, effectiveFrom: null, reviewBy: null, createdAt: "2026-01-01T00:00:00.000Z" }],
  },
];

describe("safety/trusted-adults page", () => {
  it("loads and renders the review queue", async () => {
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    mockFetchJson({ "/api/safety/trusted-adults": { trustedAdults } });
    renderWithProviders(<AdminTrustedAdultsPage />);

    expect(await screen.findByText("Guardian House")).toBeInTheDocument();
    expect(screen.getByText("Gary Guardian")).toBeInTheDocument();
    expect(screen.getByText("PENDING BOARD REVIEW")).toBeInTheDocument();
  });

  it("shows the empty state with no pending reviews", async () => {
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    mockFetchJson({ "/api/safety/trusted-adults": { trustedAdults: [] } });
    renderWithProviders(<AdminTrustedAdultsPage />);

    expect(await screen.findByText("Nothing in the queue.")).toBeInTheDocument();
  });

  it("approves a review with a shared note", async () => {
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    const fetchMock = mockFetchJson({
      "/api/safety/trusted-adults/decision": { status: "APPROVED" },
      "/api/safety/trusted-adults": { trustedAdults },
    });
    renderWithProviders(<AdminTrustedAdultsPage />);
    await screen.findByText("Guardian House");

    fireEvent.change(screen.getByLabelText(/Shared note/), { target: { value: "May pick up Bobby." } });
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/safety/trusted-adults/decision",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reviewId: 9, decision: "APPROVE", sharedNote: "May pick up Bobby." }),
        }),
      ),
    );
    expect(await screen.findByText("Recorded: APPROVED.")).toBeInTheDocument();
  });
});
