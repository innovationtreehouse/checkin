// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
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

  it("keeps the higher-scoring second selection, formats a raw phone, shows Household: None, and swaps kept/merged", async () => {
    const zack = {
      id: 30, name: "Zack Zero", email: null, phone: null, googleId: null,
      _count: { visits: 0, rawBadgeLogs: 0, programParticipants: 0, programVolunteers: 0 },
      household: null,
    };
    const belle = {
      id: 31, name: "Belle Best", email: "belle@example.com", phone: "5125551234", googleId: "g31",
      _count: { visits: 3, rawBadgeLogs: 1, programParticipants: 1, programVolunteers: 0 },
      household: null,
    };
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/membership-ops/participants/merge/analyze": { participants: [zack, belle] },
      "/api/participants/search?q=Zack": { participants: [zack] },
      "/api/participants/search?q=Belle": { participants: [belle] },
    });
    renderWithProviders(<MergeParticipants />);

    fireEvent.change(screen.getAllByPlaceholderText("Search by name or email...")[0], { target: { value: "Zack" } });
    fireEvent.click(await screen.findByText("Zack Zero", { exact: false }));
    fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "Belle" } });
    fireEvent.click(await screen.findByText("Belle Best", { exact: false }));

    await screen.findByText("Keep and augment");
    // Belle out-scores Zack (visits/badges/programs/email/google), so she's kept
    // even though she was the second one selected.
    const belleCard = screen.getByText("Belle Best (ID: 31)").closest(".mantine-Card-root") as HTMLElement;
    expect(within(belleCard).getByText("Keep and augment")).toBeInTheDocument();
    expect(within(belleCard).getByText(/512-555-1234/)).toBeInTheDocument();
    expect(within(belleCard).getByText(/Google Auth: Yes/)).toBeInTheDocument();

    const zackCard = screen.getByText("Zack Zero (ID: 30)").closest(".mantine-Card-root") as HTMLElement;
    expect(within(zackCard).getByText("Merge and delete")).toBeInTheDocument();
    expect(within(zackCard).getByText(/Household: None/)).toBeInTheDocument();
    expect(within(zackCard).getByText(/Google Auth: No/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Swap Kept / Merged" }));
    expect(within(zackCard).getByText("Keep and augment")).toBeInTheDocument();
    expect(within(belleCard).getByText("Merge and delete")).toBeInTheDocument();
  });

  it("lets you change a selected participant back to search", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockRoutes();
    renderWithProviders(<MergeParticipants />);

    fireEvent.change(screen.getAllByPlaceholderText("Search by name or email...")[0], { target: { value: "Alice" } });
    fireEvent.click(await screen.findByText("Alice Adams", { exact: false }));
    expect(screen.getByText("Alice Adams", { exact: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getAllByPlaceholderText("Search by name or email...")).toHaveLength(2);
    // The re-shown search box still has "Alice" as its value, which re-triggers the
    // search effect; let that settle so it doesn't leak an unawaited update.
    expect(await screen.findByText("Alice Adams", { exact: false })).toBeInTheDocument();
  });

  it("shows a failure message when analysis throws", async () => {
    setSession({ id: 1, isSysadmin: true });
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("q=Alice")) return { ok: true, json: async () => ({ participants: [participantA] }) } as Response;
      if (url.includes("q=Bob")) return { ok: true, json: async () => ({ participants: [participantB] }) } as Response;
      if (url.includes("merge/analyze")) throw new Error("boom");
      return { ok: false, json: async () => ({}) } as Response;
    }) as unknown as typeof fetch;
    renderWithProviders(<MergeParticipants />);

    await selectBoth();
    expect(await screen.findByText("Failed to analyze participants")).toBeInTheDocument();
  });

  it("shows a red alert and disables Proceed when the merged participant is a lead of a household with other members", async () => {
    const leo = {
      id: 40, name: "Leo Lead", email: "leo@example.com", phone: "5551234567", googleId: "g40",
      _count: { visits: 0, rawBadgeLogs: 0, programParticipants: 0, programVolunteers: 0 },
      household: { id: 100, name: "Lead House", leads: [{ personId: 40 }], householdMembers: [{ id: 40 }, { id: 41 }] },
    };
    const otto = {
      id: 41, name: "Otto Other", email: "otto@example.com", phone: null, googleId: "g41",
      _count: { visits: 10, rawBadgeLogs: 0, programParticipants: 2, programVolunteers: 0 },
      household: null,
    };
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/membership-ops/participants/merge/analyze": { participants: [leo, otto] },
      "/api/participants/search?q=Leo": { participants: [leo] },
      "/api/participants/search?q=Otto": { participants: [otto] },
    });
    renderWithProviders(<MergeParticipants />);

    fireEvent.change(screen.getAllByPlaceholderText("Search by name or email...")[0], { target: { value: "Leo" } });
    fireEvent.click(await screen.findByText("Leo Lead", { exact: false }));
    fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "Otto" } });
    fireEvent.click(await screen.findByText("Otto Other", { exact: false }));

    // Otto out-scores Leo, so Leo (the household lead) is the one slated for deletion.
    expect(await screen.findByText(/is the lead of a household with other members/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Proceed to Preview" })).toBeDisabled();
  });

  it("shows a yellow warning when the merged participant has other household members but isn't the lead", async () => {
    const mia = {
      id: 20, name: "Mia Member", email: "mia@example.com", phone: null, googleId: null,
      _count: { visits: 0, rawBadgeLogs: 0, programParticipants: 0, programVolunteers: 0 },
      household: { id: 200, name: "Member House", leads: [{ personId: 21 }], householdMembers: [{ id: 20 }, { id: 21 }] },
    };
    const hank = {
      id: 21, name: "Hank High", email: "hank@example.com", phone: null, googleId: "g21",
      _count: { visits: 5, rawBadgeLogs: 0, programParticipants: 0, programVolunteers: 0 },
      household: null,
    };
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({
      "/api/membership-ops/participants/merge/analyze": { participants: [mia, hank] },
      "/api/participants/search?q=Mia": { participants: [mia] },
      "/api/participants/search?q=Hank": { participants: [hank] },
    });
    renderWithProviders(<MergeParticipants />);

    fireEvent.change(screen.getAllByPlaceholderText("Search by name or email...")[0], { target: { value: "Mia" } });
    fireEvent.click(await screen.findByText("Mia Member", { exact: false }));
    fireEvent.change(screen.getByPlaceholderText("Search by name or email..."), { target: { value: "Hank" } });
    fireEvent.click(await screen.findByText("Hank High", { exact: false }));

    expect(await screen.findByText(/is in a household with others/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Proceed to Preview" })).toBeEnabled();
  });

  it("shows a server error, then a network-error message, when the merge request fails", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockRoutes();
    renderWithProviders(<MergeParticipants />);
    await selectBoth();
    await screen.findByText("Keep and augment");
    fireEvent.click(screen.getByRole("button", { name: "Proceed to Preview" }));
    await screen.findByText("Preview & Confirm Merge");

    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "Cannot merge." }) })) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Confirm Merge & Delete" }));
    expect(await screen.findByText("Cannot merge.")).toBeInTheDocument();

    global.fetch = jest.fn(() => Promise.reject(new Error("Connection lost"))) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Confirm Merge & Delete" }));
    expect(await screen.findByText("Connection lost")).toBeInTheDocument();

    global.fetch = jest.fn(() => Promise.reject("not an Error")) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Confirm Merge & Delete" }));
    expect(await screen.findByText("Network error")).toBeInTheDocument();
  });

  it("resets back to the search screen after Merge More", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockRoutes();
    renderWithProviders(<MergeParticipants />);
    await selectBoth();
    await screen.findByText("Keep and augment");
    fireEvent.click(screen.getByRole("button", { name: "Proceed to Preview" }));
    await screen.findByText("Preview & Confirm Merge");
    fireEvent.click(screen.getByRole("button", { name: "Confirm Merge & Delete" }));
    await screen.findByText("Merge Successful!");

    fireEvent.click(screen.getByRole("button", { name: "Merge More" }));
    expect(screen.getAllByPlaceholderText("Search by name or email...")).toHaveLength(2);
  });

  it("cancels out of preview mode back to the analysis screen", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockRoutes();
    renderWithProviders(<MergeParticipants />);
    await selectBoth();
    await screen.findByText("Keep and augment");
    fireEvent.click(screen.getByRole("button", { name: "Proceed to Preview" }));
    await screen.findByText("Preview & Confirm Merge");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByText("Keep and augment")).toBeInTheDocument();
  });
});
