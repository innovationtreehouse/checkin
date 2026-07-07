import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import BadgePrintsPage from "../page";

beforeEach(() => resetRtl());

const REPORT = {
  year: new Date().getUTCFullYear(),
  printed: [
    { personId: 1, name: "Pat Printed", email: "pat@example.com", lastPrintedAt: "2026-03-01T12:00:00.000Z", printedBy: "Admin", count: 2 },
  ],
  gaps: [{ personId: 2, name: "Gappy McGap", email: "gap@example.com" }],
};

describe("facility-ops/badge-prints page", () => {
  it("renders the printed list and the gap list", async () => {
    mockFetchJson({ "/api/facility/badge-prints": REPORT });
    renderWithProviders(<BadgePrintsPage />);

    expect(await screen.findByText("Pat Printed")).toBeInTheDocument();
    expect(screen.getByText("Gappy McGap")).toBeInTheDocument();
    // The reprint count is surfaced.
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("posts a single-person mark when a gap row's Mark printed is clicked", async () => {
    const fetchMock = mockFetchJson({ "/api/facility/badge-prints": REPORT });
    renderWithProviders(<BadgePrintsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Mark printed" }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(postCall).toBeTruthy();
      expect(JSON.parse(postCall![1]!.body as string)).toEqual({ personIds: [2] });
    });
  });

  it("bulk-marks selected people via the header select-all + Mark selected button", async () => {
    const fetchMock = mockFetchJson({ "/api/facility/badge-prints": REPORT });
    renderWithProviders(<BadgePrintsPage />);

    fireEvent.click(await screen.findByLabelText("Select all"));
    fireEvent.click(screen.getByRole("button", { name: /Mark selected printed/ }));

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(JSON.parse(postCall![1]!.body as string)).toEqual({ personIds: [2] });
    });
  });
});
