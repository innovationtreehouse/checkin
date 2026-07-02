// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl, router } from "@/test-helpers/rtl";
import MergeParticipants from "../page";

beforeEach(() => resetRtl());

const participantA = {
  id: 1, name: "Alice Adams", email: "alice@example.com", phone: null, googleId: "g1",
  _count: { visits: 5, rawBadgeLogs: 0, programParticipants: 0, programVolunteers: 0 },
  household: { id: 10, name: "Adams House", leads: [], householdMembers: [{ id: 1 }] },
};
const participantB = {
  id: 2, name: "Bob Adams", email: "bob@example.com", phone: null, googleId: null,
  _count: { visits: 0, rawBadgeLogs: 0, programParticipants: 0, programVolunteers: 0 },
  household: null,
};

function mockRoutes() {
  return mockFetchJson({
    "/api/membership-ops/participants/merge/analyze": { participants: [participantA, participantB] },
    "/api/membership-ops/participants/merge": { success: true },
    "/api/participants/search?q=Alice": { participants: [participantA] },
    "/api/participants/search?q=Bob": { participants: [participantB] },
  });
}

async function selectBoth() {
  fireEvent.change(screen.getAllByPlaceholderText("Search by name or email...")[0], { target: { value: "Alice" } });
  fireEvent.click(await screen.findByText("Alice Adams", { exact: false }));

  // Box A is now a selected card, so only box B's search input remains.
  fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "Bob" } });
  fireEvent.click(await screen.findByText("Bob Adams", { exact: false }));
}

describe("membership-ops/participants/merge page", () => {
  it("searches, selects two participants, and analyzes them", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockRoutes();
    renderWithProviders(<MergeParticipants />);

    await selectBoth();

    expect(await screen.findByText("Keep and augment")).toBeInTheDocument();
    expect(screen.getByText("Merge and delete")).toBeInTheDocument();
    // Alice scores higher (visits + googleId) so she's recommended to keep.
    expect(screen.getByRole("button", { name: "Proceed to Preview" })).toBeInTheDocument();
  });

  it("previews and confirms the merge", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockRoutes();
    renderWithProviders(<MergeParticipants />);

    await selectBoth();
    await screen.findByText("Keep and augment");

    fireEvent.click(screen.getByRole("button", { name: "Proceed to Preview" }));
    expect(await screen.findByText("Preview & Confirm Merge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Merge & Delete" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/membership-ops/participants/merge",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ keepId: 1, mergeId: 2 }) }),
      ),
    );
    expect(await screen.findByText("Merge Successful!")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back to Participants" }));
    expect(router.push).toHaveBeenCalledWith("/membership-ops/participants");
  });
});
