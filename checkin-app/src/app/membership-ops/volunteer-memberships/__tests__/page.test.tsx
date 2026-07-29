// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import VolunteerMembershipsPage from "../page";

beforeEach(() => resetRtl());

const ROSTER = "/api/membership-ops/volunteer-memberships";
const DESIGNATIONS = "/api/settings/membership/volunteer-designations";

const des = (id: number, email: string, createdAt: string) => ({ id, email, createdAt });

const roster = {
  rows: [
    {
      key: "hh:1", status: "VOLUNTEER", householdId: 1, householdName: "Alvarez",
      leads: ["Ana Alvarez"], email: "ana@example.com",
      memberSince: "2025-03-04T00:00:00.000Z", designations: [],
    },
    {
      key: "des:7", status: "DESIGNATED", householdId: null, householdName: null,
      leads: [], email: "zoe@example.com",
      memberSince: null, designations: [des(7, "zoe@example.com", "2026-07-01T00:00:00.000Z")],
    },
    {
      key: "des:8", status: "NEXT_RENEWAL", householdId: 5, householdName: "Baker",
      leads: ["Bo Baker"], email: "bo@example.com",
      memberSince: "2024-01-02T00:00:00.000Z", designations: [des(8, "bo@example.com", "2026-07-02T00:00:00.000Z")],
    },
  ],
};

const bodyRowText = () =>
  screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");

describe("membership-ops/volunteer-memberships page", () => {
  it("lists current volunteer households alongside pre-designated emails", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ [ROSTER]: roster });
    renderWithProviders(<VolunteerMembershipsPage />);

    expect(await screen.findByText("Alvarez")).toBeInTheDocument();
    expect(screen.getByText("zoe@example.com")).toBeInTheDocument();
    // Scoped to the rows: the filter chips carry the same status labels.
    expect(bodyRowText()[0]).toContain("Volunteer member");
    // The designation is the subject, not the household: it is inert until renewal.
    expect(bodyRowText()[2]).toContain("Takes effect next renewal");
    // A designation with no household reads as not-yet-signed-up, not a blank cell.
    expect(screen.getByText("Not signed up yet")).toBeInTheDocument();
  });

  it("shows the empty state when there are no volunteers or designations", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ [ROSTER]: { rows: [] } });
    renderWithProviders(<VolunteerMembershipsPage />);

    expect(await screen.findByText("No volunteers or designations yet.")).toBeInTheDocument();
  });

  it("distinguishes a failed load from an empty roster", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({}); // every fetch 404s
    renderWithProviders(<VolunteerMembershipsPage />);

    expect(await screen.findByText(/Could not load the volunteer roster/)).toBeInTheDocument();
    expect(screen.queryByText("No volunteers or designations yet.")).not.toBeInTheDocument();
  });

  it("filters by search across household, lead, and email", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ [ROSTER]: roster });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("Alvarez");

    fireEvent.change(screen.getByLabelText("Search volunteers"), { target: { value: "bo baker" } });

    await waitFor(() => expect(bodyRowText()).toHaveLength(1));
    expect(bodyRowText()[0]).toContain("Baker");
  });

  it("filters by status chip", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ [ROSTER]: roster });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("Alvarez");

    fireEvent.click(screen.getByRole("checkbox", { name: "Pre-designated" }));

    await waitFor(() => expect(bodyRowText()).toHaveLength(1));
    expect(bodyRowText()[0]).toContain("zoe@example.com");
  });

  it("sorts by household when the column header is clicked", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ [ROSTER]: roster });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("Alvarez");

    fireEvent.click(within(screen.getAllByRole("row")[0]).getByRole("button", { name: /Household/ }));

    // asc: Alvarez, Baker, then the null household last.
    await waitFor(() => expect(bodyRowText()[0]).toContain("Alvarez"));
    expect(bodyRowText()[1]).toContain("Baker");
    expect(bodyRowText()[2]).toContain("Not signed up yet");
  });

  it("adds a new designation and reloads the roster", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ [ROSTER]: () => roster, [DESIGNATIONS]: () => ({}) });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("Alvarez");

    fireEvent.change(screen.getByLabelText("Volunteer email"), { target: { value: "new@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        DESIGNATIONS,
        expect.objectContaining({ method: "POST", body: JSON.stringify({ email: "new@example.com" }) }),
      ),
    );
    await waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]) === ROSTER)).toHaveLength(2));
  });

  it("removes a designation from its roster row", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ [ROSTER]: roster, [DESIGNATIONS]: {} });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("zoe@example.com");

    // Only the two designation-backed rows offer Remove; the plain volunteer household does not.
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
    // A row that IS an email needs no address on the button; a household row does,
    // because the designation it removes is one of the household's emails.
    expect(screen.getByRole("button", { name: "Remove zoe@example.com" })).toHaveTextContent(/^Remove$/);
    expect(screen.getByRole("button", { name: "Remove bo@example.com" })).toHaveTextContent("Remove bo@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Remove zoe@example.com" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${DESIGNATIONS}?id=7`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("gives every designation on one household its own Remove action", async () => {
    setSession({ id: 1, isSysadmin: true });
    const rows = [{
      key: "hh:1", status: "VOLUNTEER", householdId: 1, householdName: "Alvarez",
      leads: ["Ana Alvarez", "Alex Alvarez"], email: "ana@example.com",
      memberSince: "2025-03-04T00:00:00.000Z",
      designations: [des(7, "ana@example.com", "2026-07-01T00:00:00.000Z"), des(8, "alex@example.com", "2026-07-02T00:00:00.000Z")],
    }];
    const fetchMock = mockFetchJson({ [ROSTER]: { rows }, [DESIGNATIONS]: {} });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("Alvarez");

    // Folding both onto one row must not cost either its only Remove.
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Remove alex@example.com" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `${DESIGNATIONS}?id=8`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("surfaces a failed remove instead of silently reporting success", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ [ROSTER]: roster }); // DELETE 404s
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("zoe@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Remove zoe@example.com" }));

    expect(await screen.findByText(/Could not remove that designation/)).toBeInTheDocument();
    // The row is still there — nothing was removed.
    expect(screen.getByText("zoe@example.com")).toBeInTheDocument();
  });

  it("hides volunteer households with no live application until asked", async () => {
    setSession({ id: 1, isSysadmin: true });
    const rows = [
      roster.rows[0],
      {
        key: "hh:9", status: "INACTIVE", householdId: 9, householdName: "Chen",
        leads: ["Cy Chen"], email: "cy@example.com", memberSince: null, designations: [],
      },
    ];
    mockFetchJson({ [ROSTER]: { rows } });
    renderWithProviders(<VolunteerMembershipsPage />);
    await screen.findByText("Alvarez");

    expect(screen.queryByText("Chen")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show inactive"));

    expect(await screen.findByText("Chen")).toBeInTheDocument();
    expect(bodyRowText()[1]).toContain("No live application");
  });

  it("keeps an inactive household visible when a designation hangs off it", async () => {
    setSession({ id: 1, isSysadmin: true });
    const rows = [{
      key: "hh:9", status: "INACTIVE", householdId: 9, householdName: "Chen",
      leads: ["Cy Chen"], email: "cy@example.com", memberSince: null,
      designations: [des(4, "cy@example.com", "2026-07-01T00:00:00.000Z")],
    }];
    mockFetchJson({ [ROSTER]: { rows } });
    renderWithProviders(<VolunteerMembershipsPage />);

    // Hiding it would hide the only Remove action for designation 4.
    expect(await screen.findByText("Chen")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove cy@example.com" })).toBeInTheDocument();
  });

  it("renders nothing for a background-check reviewer who navigates directly", async () => {
    setSession({ id: 9, isBackgroundCheckReviewer: true });
    mockFetchJson({ [ROSTER]: roster });
    renderWithProviders(<VolunteerMembershipsPage />);

    // The load effect still fires before the guard's early return — let it settle.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Add" })).not.toBeInTheDocument());
    expect(screen.queryByText("Volunteers")).not.toBeInTheDocument();
  });
});
