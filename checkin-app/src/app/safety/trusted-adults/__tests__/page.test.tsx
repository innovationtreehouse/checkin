// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl, router } from "@/test-helpers/rtl";
import AdminTrustedAdultsPage from "../page";

beforeEach(() => resetRtl());

const trustedAdults = [
  {
    id: 1,
    trustedAdultName: "Gary Guardian",
    trustedAdultPhone: null,
    trustedAdultEmail: null,
    familyContext: "Family friend, watches the kids after school.",
    origin: "SELF_DISCLOSED",
    createdAt: "2026-01-01T00:00:00.000Z",
    household: { id: 5, name: "Guardian House", leads: [] },
    trustedAdultPerson: null,
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

  it("redirects a caller without board/sysadmin role, and shows a loader while resolving", () => {
    setSession(null, "loading");
    renderWithProviders(<AdminTrustedAdultsPage />);
    expect(screen.queryByText("Trusted Adults — Board Review")).not.toBeInTheDocument();

    setSession({ id: 1 });
    renderWithProviders(<AdminTrustedAdultsPage />);
    expect(router.push).toHaveBeenCalledWith("/");
  });

  it("denies a review, and requests info via a prompt (skipping when the prompt is cancelled)", async () => {
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    const fetchMock = mockFetchJson({
      "/api/safety/trusted-adults/decision": { status: "DENIED" },
      "/api/safety/trusted-adults": { trustedAdults },
    });
    renderWithProviders(<AdminTrustedAdultsPage />);
    await screen.findByText("Guardian House");

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/safety/trusted-adults/decision",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ reviewId: 9, decision: "DENY" }) }),
      ),
    );
    expect(await screen.findByText("Recorded: DENIED.")).toBeInTheDocument();

    window.prompt = jest.fn(() => null);
    fireEvent.click(screen.getByRole("button", { name: "Request info" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/safety/trusted-adults/decision",
        expect.objectContaining({ body: JSON.stringify({ reviewId: 9, decision: "REQUEST_INFO", note: "" }) }),
      ),
    );

    window.prompt = jest.fn(() => "Need proof of ID.");
    fireEvent.click(screen.getByRole("button", { name: "Request info" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/safety/trusted-adults/decision",
        expect.objectContaining({ body: JSON.stringify({ reviewId: 9, decision: "REQUEST_INFO", note: "Need proof of ID." }) }),
      ),
    );
  });

  it("leaves an empty queue when the initial load fails", async () => {
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    renderWithProviders(<AdminTrustedAdultsPage />);
    expect(await screen.findByText("Nothing in the queue.")).toBeInTheDocument();
  });

  it("shows the fallback failure message on a decision error, and dismisses the alert", async () => {
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    mockFetchJson({ "/api/safety/trusted-adults": { trustedAdults } });
    const { container } = renderWithProviders(<AdminTrustedAdultsPage />);
    await screen.findByText("Guardian House");

    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Deny" }));
    expect(await screen.findByText("Decision failed.")).toBeInTheDocument();

    fireEvent.click(container.querySelector(".mantine-CloseButton-root")!);
    expect(screen.queryByText("Decision failed.")).not.toBeInTheDocument();
  });

  it("renders a shared note, lead names, review-by date, and disables actions on a conflict of interest", async () => {
    const conflicted = [
      {
        ...trustedAdults[0],
        household: { id: 1, name: "Guardian House", leads: [{ person: { name: "Lead Lucy", email: "lucy@example.com" } }] },
        reviews: [{ ...trustedAdults[0].reviews[0], sharedNote: "Already shared.", reviewBy: "2026-02-01T00:00:00.000Z" }],
      },
    ];
    setSession({ id: 1, isBoardMember: true, householdId: 1 }); // same householdId as ta.household.id -> conflict
    mockFetchJson({ "/api/safety/trusted-adults": { trustedAdults: conflicted } });
    renderWithProviders(<AdminTrustedAdultsPage />);
    await screen.findByText("Guardian House");

    expect(screen.getByText(/Already shared\./)).toBeInTheDocument();
    expect(screen.getByText(/Lead Lucy/)).toBeInTheDocument();
    expect(screen.getByText(/Review by 2026-02-01/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Deny" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Request info" })).toBeDisabled();
  });

  it("shows override actions for a decided-but-not-revoked review, and force-approves only with a note", async () => {
    const decided = [
      {
        ...trustedAdults[0],
        reviews: [{ ...trustedAdults[0].reviews[0], status: "APPROVED" }],
      },
    ];
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    const fetchMock = mockFetchJson({
      "/api/safety/trusted-adults/override": { status: "APPROVED" },
      "/api/safety/trusted-adults": { trustedAdults: decided },
    });
    renderWithProviders(<AdminTrustedAdultsPage />);
    await screen.findByText("Guardian House");

    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.getByText("Override:")).toBeInTheDocument();

    window.prompt = jest.fn(() => "");
    fireEvent.click(screen.getByRole("button", { name: "Force approve" }));
    await waitFor(() => expect(window.prompt).toHaveBeenCalled());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/safety/trusted-adults/override", expect.anything());

    window.prompt = jest.fn(() => "Confirmed with family.");
    fireEvent.click(screen.getByRole("button", { name: "Force approve" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/safety/trusted-adults/override",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ reviewId: 9, action: "approve", sharedNote: "Confirmed with family." }),
        }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Force deny" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/safety/trusted-adults/override",
        expect.objectContaining({ body: JSON.stringify({ reviewId: 9, action: "deny" }) }),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/safety/trusted-adults/override",
        expect.objectContaining({ body: JSON.stringify({ reviewId: 9, action: "revoke" }) }),
      ),
    );
  });

  it("hides override actions for a revoked review, and shows an override failure message", async () => {
    const revoked = [{ ...trustedAdults[0], reviews: [{ ...trustedAdults[0].reviews[0], status: "REVOKED" }] }];
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    mockFetchJson({ "/api/safety/trusted-adults": { trustedAdults: revoked } });
    renderWithProviders(<AdminTrustedAdultsPage />);
    await screen.findByText("Guardian House");

    expect(screen.queryByText("Override:")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows an override failure message", async () => {
    const decided = [{ ...trustedAdults[0], reviews: [{ ...trustedAdults[0].reviews[0], status: "APPROVED" }] }];
    setSession({ id: 1, isBoardMember: true, householdId: 1 });
    mockFetchJson({ "/api/safety/trusted-adults": { trustedAdults: decided } });
    renderWithProviders(<AdminTrustedAdultsPage />);
    await screen.findByText("Guardian House");

    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "Cannot revoke." }) })) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Cannot revoke.")).toBeInTheDocument();
  });
});
