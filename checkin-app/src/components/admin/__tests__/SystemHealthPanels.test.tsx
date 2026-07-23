import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { SystemVersionBox, BadgeScanChart, SReadDiagnosticsBox } from "../SystemHealthPanels";

beforeEach(() => resetRtl());

describe("SystemVersionBox", () => {
  it("shows up to date when the running version matches the latest commit", async () => {
    mockFetchJson({
      "/api/system-status/kiosk-version": { version: "abc1234" },
      "commits/main": { sha: "abc1234" },
    });
    renderWithProviders(<SystemVersionBox />);
    expect(await screen.findByText(/System is up to date/)).toBeInTheDocument();
  });

  it("shows an update banner + commit list when behind main", async () => {
    mockFetchJson({
      "/api/system-status/kiosk-version": { version: "aaa1111" },
      "commits/main": { sha: "bbb2222" },
      "compare/": { commits: [{ sha: "ccc3333", html_url: "https://x/ccc3333", commit: { message: "Fix the thing\nmore detail" } }] },
    });
    renderWithProviders(<SystemVersionBox />);
    expect(await screen.findByText(/Update Available!/)).toBeInTheDocument();
    expect(screen.getByText(/Fix the thing/)).toBeInTheDocument();
  });
});

describe("BadgeScanChart", () => {
  it("renders the latency chart legend once stats load", async () => {
    mockFetchJson({
      "/api/system-status/health": {
        days: [
          { date: "2026-06-01", count: 10, median: 20, p90: 40, p99: 60 },
          { date: "2026-06-02", count: 12, median: 22, p90: 41, p99: 61 },
          { date: "2026-06-03", count: 9, median: 19, p90: 39, p99: 58 },
        ],
      },
    });
    renderWithProviders(<BadgeScanChart />);
    expect(await screen.findByText("Median")).toBeInTheDocument();
    expect(screen.getByText("P90")).toBeInTheDocument();
    expect(screen.getByText("P99")).toBeInTheDocument();
  });

  it("shows a failure message when the health endpoint has no data", async () => {
    mockFetchJson({});
    renderWithProviders(<BadgeScanChart />);
    expect(await screen.findByText("Failed to load metrics.")).toBeInTheDocument();
  });
});

describe("SReadDiagnosticsBox", () => {
  it("does not probe until clicked, then renders each step's verdict and code", async () => {
    mockFetchJson({
      "/api/finance-ops/s-read/diagnose": {
        steps: [
          { id: "env", ok: true, detail: 'Resolved via DATABASE_URL + SHOPIFY_READ_DB: database "shopify_read_dev" on db.internal.' },
          { id: "mirror-read", ok: false, code: "42501", detail: "Table exists, but SELECT is denied — grant-holder membership missing." },
          { id: "latest-run", ok: null, detail: "Skipped — an earlier step already failed." },
        ],
      },
    });
    renderWithProviders(<SReadDiagnosticsBox />);

    // On-load the box must be inert — probing wakes the Aurora cluster.
    expect(global.fetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Run diagnostics/ }));
    expect(await screen.findByText(/SELECT is denied/)).toBeInTheDocument();
    expect(screen.getByText("42501")).toBeInTheDocument();
    expect(screen.getByText("● OK")).toBeInTheDocument();
    expect(screen.getByText("● FAIL")).toBeInTheDocument();
    expect(screen.getByText("● Skipped")).toBeInTheDocument();
  });

  it("shows a failure line when the endpoint itself is unreachable", async () => {
    mockFetchJson({});
    renderWithProviders(<SReadDiagnosticsBox />);
    fireEvent.click(screen.getByRole("button", { name: /Run diagnostics/ }));
    expect(await screen.findByText(/Diagnostics failed to run/)).toBeInTheDocument();
  });
});
