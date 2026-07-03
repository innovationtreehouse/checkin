jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { notifications } from "@mantine/notifications";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { AdminEditHouseholdModal, isFormDirty } from "../AdminEditHouseholdModal";

const base = { name: "Smith", line1: "1 Main", line2: "", city: "Austin", state: "TX", postalCode: "78701", emergencyContactName: "Jo", emergencyContactPhone: "5550000", memberSince: "2020-01-15" };

describe("isFormDirty", () => {
  it("is false when snapshots match", () => {
    expect(isFormDirty(base, { ...base })).toBe(false);
  });

  it("is true when any field differs", () => {
    expect(isFormDirty(base, { ...base, name: "Jones" })).toBe(true);
    expect(isFormDirty(base, { ...base, emergencyContactPhone: "5551111" })).toBe(true);
    expect(isFormDirty(base, { ...base, memberSince: "2021-06-01" })).toBe(true);
  });
});

const household = {
  id: 55,
  name: "Smith Family",
  line1: "1 Main St",
  line2: "Apt 2",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  emergencyContactName: "Jo Smith",
  emergencyContactPhone: "555-123-4567",
  householdMembers: [
    { id: 1, name: "Kid A", email: "kid@example.com" },
    { id: 2, name: null, email: null },
  ],
  householdLeads: [{ personId: 1 }, { personId: 2 }],
};

beforeEach(() => {
  resetRtl();
  (notifications.show as jest.Mock).mockClear();
});

describe("AdminEditHouseholdModal", () => {
  it("does nothing while closed or without a household id", () => {
    const fetchMock = mockFetchJson({});
    renderWithProviders(<AdminEditHouseholdModal householdId={null} opened={true} onClose={jest.fn()} />);
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={false} onClose={jest.fn()} />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows a loading spinner while the household is in flight", async () => {
    let resolveFetch!: (v: unknown) => void;
    global.fetch = jest.fn(() => new Promise((resolve) => { resolveFetch = resolve; })) as unknown as typeof fetch;
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={jest.fn()} />);

    // Modal content renders into a portal (outside the render() container), and
    // mounts on a transition tick, not synchronously.
    await waitFor(() => expect(document.querySelector(".mantine-Loader-root")).toBeInTheDocument());
    expect(screen.queryByLabelText("Household Name")).not.toBeInTheDocument();

    resolveFetch({ ok: true, json: async () => ({ household }) });
    expect(await screen.findByDisplayValue("Smith Family")).toBeInTheDocument();
  });

  it("loads and lets every field be edited, then saves as admin", async () => {
    const onSaved = jest.fn();
    const onClose = jest.fn();
    const fetchMock = mockFetchJson({
      "/api/membership-ops/households?id=55": { household },
      "/api/membership-ops/households/55": { household: { ...household, name: "Smith Fam" } },
    });
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={onClose} onSaved={onSaved} />);

    expect(await screen.findByDisplayValue("Smith Family")).toBeInTheDocument();
    expect(screen.getByText("Edit Household Info — Smith Family")).toBeInTheDocument();
    expect(screen.getByText("Kid A")).toBeInTheDocument();
    expect(screen.getByText("kid@example.com")).toBeInTheDocument();
    expect(screen.getByText("#2")).toBeInTheDocument(); // name fallback for the null-named lead

    fireEvent.change(screen.getByLabelText("Household Name"), { target: { value: "Smith Fam" } });
    fireEvent.change(screen.getByLabelText("Street Address"), { target: { value: "2 Main St" } });
    fireEvent.change(screen.getByLabelText("Apt / Suite (optional)"), { target: { value: "Apt 3" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Round Rock" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "TX" } });
    fireEvent.change(screen.getByLabelText("ZIP"), { target: { value: "78664" } });
    fireEvent.change(screen.getByLabelText("Emergency Contact Name"), { target: { value: "Jo S." } });
    fireEvent.change(screen.getByLabelText("Emergency Contact Phone"), { target: { value: "5559999999" } });

    // Admin-power notice is inline; save is a single orange button.
    expect(screen.getByText(/editing/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes — As Admin" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/membership-ops/households/55", expect.objectContaining({ method: "PATCH" })),
    );
    const [, patchOpts] = fetchMock.mock.calls.find(([, opts]) => opts?.method === "PATCH")!;
    expect(JSON.parse(patchOpts!.body as string)).toEqual(
      expect.objectContaining({ name: "Smith Fam", line1: "2 Main St", city: "Round Rock", postalCode: "78664" }),
    );

    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "green" })));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ name: "Smith Fam" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an inline phone error and blocks save until fixed", async () => {
    const fetchMock = mockFetchJson({ "/api/membership-ops/households?id=55": { household } });
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={jest.fn()} />);
    await screen.findByDisplayValue("Smith Family");

    fetchMock.mockClear();
    fireEvent.change(screen.getByLabelText("Emergency Contact Phone"), { target: { value: "555" } });
    expect(screen.getByText("Enter a valid 10-digit US phone number.")).toBeInTheDocument();

    const save = screen.getByRole("button", { name: "Save Changes — As Admin" });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/membership-ops/households/55", expect.anything());
  });

  it("prompts before discarding unsaved edits, and closes directly when nothing changed", async () => {
    const onClose = jest.fn();
    mockFetchJson({ "/api/membership-ops/households?id=55": { household } });
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={onClose} />);
    await screen.findByDisplayValue("Smith Family");

    // Not dirty -> closes without prompting.
    window.confirm = jest.fn();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Household Name"), { target: { value: "Changed" } });

    window.confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1); // still just the earlier call — cancelled this time

    window.confirm = jest.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows an error notification when the household fails to load", async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={jest.fn()} />);

    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ color: "red", message: "Failed to load household." })),
    );
    expect(screen.getByLabelText("Household Name")).toHaveValue("");
  });

  it("shows a server error message, then a network-error message, when saving fails", async () => {
    mockFetchJson({ "/api/membership-ops/households?id=55": { household } });
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={jest.fn()} />);
    await screen.findByDisplayValue("Smith Family");

    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "Name taken." }) })) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Save Changes — As Admin" }));
    // Failure routes to a modal-local Alert next to the form, not a corner toast.
    expect(await screen.findByText("Name taken.")).toBeInTheDocument();
    // The modal stays open on failure (only success calls onClose).
    expect(screen.getByText(/Edit Household Info/)).toBeInTheDocument();

    global.fetch = jest.fn(() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    fireEvent.click(screen.getByRole("button", { name: "Save Changes — As Admin" }));
    expect(await screen.findByText("Network error.")).toBeInTheDocument();
  });

  it("removes a lead (reloading after success) and blocks removing the last lead", async () => {
    mockFetchJson({
      "/api/membership-ops/households?id=55": { household },
      "/api/household/lead": { ok: true },
    });
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={jest.fn()} />);
    await screen.findByDisplayValue("Smith Family");

    const removeButtons = screen.getAllByRole("button", { name: "Remove lead" });
    expect(removeButtons).toHaveLength(2);
    expect(removeButtons[0]).toBeEnabled();

    const reduced = { ...household, householdLeads: [{ personId: 2 }] };
    const fetchMock = mockFetchJson({
      "/api/household/lead": { ok: true },
      "/api/membership-ops/households?id=55": { household: reduced },
    });
    fireEvent.click(removeButtons[0]);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/household/lead",
        expect.objectContaining({ method: "DELETE", body: JSON.stringify({ participantId: 1 }) }),
      ),
    );
    expect(await screen.findByText("Lead removed.")).toBeInTheDocument();

    // Now down to a single lead: the last remaining Remove-lead button is disabled
    // and the "must keep at least one lead" copy shows.
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Remove lead" })).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Remove lead" })).toBeDisabled();
    expect(screen.getByText("A household must keep at least one lead.")).toBeInTheDocument();
  });

  it("shows a failure notification, and a network-error notification, when removing a lead", async () => {
    mockFetchJson({ "/api/membership-ops/households?id=55": { household } });
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={jest.fn()} />);
    await screen.findByDisplayValue("Smith Family");

    global.fetch = jest.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: "Cannot remove." }) })) as unknown as typeof fetch;
    fireEvent.click(screen.getAllByRole("button", { name: "Remove lead" })[0]);
    expect(await screen.findByText("Cannot remove.")).toBeInTheDocument();

    global.fetch = jest.fn(() => Promise.reject(new Error("net"))) as unknown as typeof fetch;
    fireEvent.click(screen.getAllByRole("button", { name: "Remove lead" })[0]);
    expect(await screen.findByText("Network error.")).toBeInTheDocument();
  });

  it("shows the no-leads state for a household with no household leads", async () => {
    const noLeads = { ...household, householdLeads: undefined, name: null };
    mockFetchJson({ "/api/membership-ops/households?id=55": { household: noLeads } });
    renderWithProviders(<AdminEditHouseholdModal householdId={55} opened={true} onClose={jest.fn()} />);

    expect(await screen.findByText("No leads on this household.")).toBeInTheDocument();
    expect(screen.getByText("Edit Household Info — Household #55")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove lead" })).not.toBeInTheDocument();
  });
});
