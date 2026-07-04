// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
jest.mock("@mantine/notifications", () => ({ notifications: { show: jest.fn() } }));

import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import { notifications } from "@mantine/notifications";
import AdminVisitsPage from "../page";

beforeEach(() => { resetRtl(); (notifications.show as jest.Mock).mockClear(); });

const visits = [
  { id: 1, arrivedAt: "2026-01-01T14:00:00.000Z", departedAt: "2026-01-01T16:00:00.000Z", arrivedVia: "SCANNER", departedVia: "WEB", person: { name: "Val Volunteer" }, event: { name: "Open Gym" } },
  { id: 2, arrivedAt: "2026-01-02T14:00:00.000Z", departedAt: null, arrivedVia: "WEB", person: { name: "Stu Student" }, event: null },
];

describe("facility-ops/visits page", () => {
  it("loads and renders visit rows", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/facility/visits": { visits } });
    renderWithProviders(<AdminVisitsPage />);

    expect(await screen.findByText("Val Volunteer")).toBeInTheDocument();
    expect(screen.getByText("Stu Student")).toBeInTheDocument();
    expect(screen.getByText("Open Gym")).toBeInTheDocument();
    expect(screen.getByText("Open Facility")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("re-sorts rows when a sortable header is clicked", async () => {
    setSession({ id: 1, isSysadmin: true });
    mockFetchJson({ "/api/facility/visits": { visits } });
    renderWithProviders(<AdminVisitsPage />);
    await screen.findByText("Val Volunteer");

    fireEvent.click(screen.getByRole("button", { name: /Participant/ }));

    const rows = screen.getAllByRole("row").slice(1); // drop header row
    expect(rows[0]).toHaveTextContent("Stu Student");
  });

  it("edits and saves a visit's arrival/departure", async () => {
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/facility/visits": { visits } });
    renderWithProviders(<AdminVisitsPage />);
    await screen.findByText("Val Volunteer");

    // Edit the already-closed row (id 1) — sort is arrivedAt desc so it's second.
    // Both times are set, so the save passes the client pre-check and fires the PATCH.
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[1]);
    const confirmModal = await screen.findByRole("dialog", { name: "Edit Past Visit Record" });
    fireEvent.click(within(confirmModal).getByRole("button", { name: "Continue" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/facility/visits",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: "Visit updated successfully." })));
  });
});
