// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import AdminVisitsPage from "../page";

beforeEach(() => resetRtl());

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
    window.confirm = jest.fn(() => true);
    setSession({ id: 1, isSysadmin: true });
    const fetchMock = mockFetchJson({ "/api/facility/visits": { visits } });
    renderWithProviders(<AdminVisitsPage />);
    await screen.findByText("Val Volunteer");

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(window.confirm).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/facility/visits",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    expect(await screen.findByText("Visit updated successfully.")).toBeInTheDocument();
  });
});
