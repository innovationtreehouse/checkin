import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import { SystemVersionBox, BadgeScanChart } from "../SystemHealthPanels";

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
