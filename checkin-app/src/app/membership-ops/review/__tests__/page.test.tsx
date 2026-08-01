// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { ModalsProvider } from "@mantine/modals";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import MembershipReviewPage from "../page";

// modals.openConfirmModal is a no-op without a provider, so the confirmed action
// would silently never fire. Wrapped here rather than in the shared harness: several
// suites jest.mock("@mantine/modals") and would get an undefined ModalsProvider.
const renderPage = () => renderWithProviders(<ModalsProvider><MembershipReviewPage /></ModalsProvider>);

beforeEach(() => { resetRtl(); (notifications.show as jest.Mock).mockClear(); });

const queue = {
  queue: [
    {
      id: 100,
      orgMembership: { household: { name: "The Smiths", intakeNotes: "We're volunteer only — no students.", householdMembers: [{ id: 1, name: "Pat Smith", email: "pat@example.com" }] } },
      _count: { attestations: 1 },
    },
  ],
};

// The same household with no approvals yet — the first-reviewer confirmation.
const firstApprovalQueue = { queue: [{ ...queue.queue[0], id: 101, _count: { attestations: 0 } }] };

describe("membership-ops/review page", () => {
  it("loads and renders the review queue", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/membership/reviews": queue });
    renderPage();

    expect(await screen.findByText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("Pat Smith <pat@example.com>", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("1/2 approvals so far.")).toBeInTheDocument();
    // The applicant's freeform note is surfaced on the card (the volunteer signal).
    expect(screen.getByText("We're volunteer only — no students.")).toBeInTheDocument();
  });

  it("approves an attestation", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/membership/reviews": queue });
    renderPage();
    await screen.findByText("The Smiths");

    fireEvent.click(screen.getByRole("button", { name: "Attest — check is clean" }));
    // This row already holds one approval, so the confirm names the consequence of
    // the CLEARING approve rather than a generic "are you sure?".
    expect(await screen.findByText("Clear this background check?")).toBeInTheDocument();
    expect(screen.getByText(/emails the family/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the queue GET only — nothing posted yet
    fireEvent.click(screen.getByRole("button", { name: "Clear the check" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/membership/reviews",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ processId: 100, result: "APPROVE", isMarkedVolunteer: false }),
        }),
      ),
    );
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Attestation recorded — thank you." })));
  });

  it("cancelling the confirmation posts nothing", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/membership/reviews": queue });
    renderPage();
    await screen.findByText("The Smiths");

    fireEvent.click(screen.getByRole("button", { name: "Attest — check is clean" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByText("Clear this background check?")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1); // the queue GET only
  });

  it("confirms a first approval without promising clearance", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/membership/reviews": firstApprovalQueue });
    renderPage();
    await screen.findByText("The Smiths");

    fireEvent.click(screen.getByRole("button", { name: "Attest — check is clean" }));
    expect(await screen.findByText("Record your approval?")).toBeInTheDocument();
    expect(screen.getByText(/A second\s+reviewer must also approve/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/membership/reviews",
        expect.objectContaining({ body: JSON.stringify({ processId: 101, result: "APPROVE", isMarkedVolunteer: false }) }),
      ),
    );
  });

  it("confirms a rejection too — the note is not the confirmation", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/membership/reviews": firstApprovalQueue });
    renderPage();
    await screen.findByText("The Smiths");

    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Record is concerning." } });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(await screen.findByText("Reject this background check?")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/membership/reviews",
        expect.objectContaining({
          body: JSON.stringify({ processId: 101, result: "REJECT", isMarkedVolunteer: false, note: "Record is concerning." }),
        }),
      ),
    );
  });

  it("shows the forbidden card when the queue endpoint returns 403", async () => {
    setSession({ id: 1, isSysadmin: true });
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })) as unknown as typeof fetch;
    renderPage();

    expect(await screen.findByText("Background-check review")).toBeInTheDocument();
  });

  it("shows the empty state when nothing is queued", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/membership/reviews": { queue: [] } });
    renderPage();

    expect(await screen.findByText("Nothing awaiting your review right now.")).toBeInTheDocument();
  });

  it("renders a PERSON_BG row by its subject identity (falls back when the household has no name)", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/membership/reviews": {
        queue: [{
          id: 200,
          subjectPerson: { id: 9, name: "Dana Vol", householdId: 5, household: { name: null } },
          orgMembership: null,
          _count: { attestations: 0 },
        }],
      },
    });
    renderPage();

    expect(await screen.findByText("Dana Vol")).toBeInTheDocument();
    expect(screen.getByText("No household on file", { exact: false })).toBeInTheDocument();
    // The volunteer-only checkbox is a household-application concept — hidden for PERSON_BG.
    expect(screen.queryByText("This is a volunteer only family (no students)")).not.toBeInTheDocument();
  });
});
