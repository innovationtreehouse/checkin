import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { ErrorLogPanel } from "../ErrorLogPanel";

beforeEach(() => resetRtl());

const errors = [
  {
    id: 1,
    timestamp: "2026-06-01T12:00:00Z",
    route: "/api/checkin",
    message: "Boom",
    context: { userId: 9 },
  },
];

describe("ErrorLogPanel", () => {
  it("renders loaded rows", async () => {
    mockFetchJson({ "/api/system-status/errors": { errors } });
    renderWithProviders(<ErrorLogPanel />);
    expect(await screen.findByText("Boom")).toBeInTheDocument();
    expect(screen.getByText("/api/checkin")).toBeInTheDocument();
  });

  it("expands and collapses a row to show context", async () => {
    mockFetchJson({ "/api/system-status/errors": { errors } });
    renderWithProviders(<ErrorLogPanel />);
    const row = await screen.findByText("Boom");

    fireEvent.click(row);
    expect(await screen.findByText(/"userId": 9/)).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.queryByText(/"userId": 9/)).not.toBeInTheDocument();
  });

  it("shows the empty message when there are no errors", async () => {
    mockFetchJson({ "/api/system-status/errors": { errors: [] } });
    renderWithProviders(<ErrorLogPanel />);
    expect(await screen.findByText(/No backend errors logged\./)).toBeInTheDocument();
  });

  it("shows a failure message when the fetch fails", async () => {
    mockFetchJson({});
    renderWithProviders(<ErrorLogPanel />);
    expect(await screen.findByText("Failed to load error log.")).toBeInTheDocument();
  });
});
