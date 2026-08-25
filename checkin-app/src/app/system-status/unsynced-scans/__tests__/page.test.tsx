import { fireEvent, screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import SystemStatusUnsyncedScansPage from "../page";

beforeEach(() => resetRtl());

const scan = (over: Record<string, unknown> = {}) => ({
    id: 5,
    // 40 minutes ago, so the D7 "40 min late" is a real computation, not a fixture string.
    timestamp: new Date(Date.now() - 40 * 60_000).toISOString(),
    location: "Main Entrance",
    reviewReason: "stale_replay",
    person: { id: 12, name: "Ada Lovelace" },
    ...over,
});

describe("SystemStatusUnsyncedScansPage", () => {
    it("renders the D7 row copy for a parked scan", async () => {
        mockFetchJson({ "/api/system-status/unsynced-scans": { scans: [scan()] } });
        renderWithProviders(<SystemStatusUnsyncedScansPage />);

        // "Person X, scanned 2:14pm, 40 min late" — the time is formatted in the
        // org zone, so match the parts that do not depend on it.
        const row = await screen.findByText(/Ada Lovelace, scanned .*, 40 min late/);
        expect(row).toBeInTheDocument();
        expect(screen.getByText(/queued scan arrived after the freshness window/)).toBeInTheDocument();
    });

    // The fallback numbers the PERSON, not the RawBadgeLog row — two different
    // ids that only diverge when they differ, which is why this needs its own case.
    it("falls back to the person's id, not the scan row's, when the name is blank", async () => {
        mockFetchJson({
            "/api/system-status/unsynced-scans": {
                scans: [scan({ id: 5, person: { id: 12, name: null } })],
            },
        });
        renderWithProviders(<SystemStatusUnsyncedScansPage />);

        expect(await screen.findByText(/Person #12, scanned /)).toBeInTheDocument();
        expect(screen.queryByText(/Person #5,/)).not.toBeInTheDocument();
    });

    it("offers a deep link to the manual-visit tool, and mints nothing itself", async () => {
        mockFetchJson({ "/api/system-status/unsynced-scans": { scans: [scan()] } });
        renderWithProviders(<SystemStatusUnsyncedScansPage />);

        const link = await screen.findByRole("link", { name: "Record visit" });
        expect(link).toHaveAttribute("href", "/facility-ops/visits");
    });

    it("dismisses a row by POSTing to it, then drops it from the list", async () => {
        // Longest key first: mockFetchJson matches by substring, so the list
        // route would otherwise swallow the dismiss URL.
        const fetchMock = mockFetchJson({
            "/api/system-status/unsynced-scans/5": {},
            "/api/system-status/unsynced-scans": { scans: [scan()] },
        });
        renderWithProviders(<SystemStatusUnsyncedScansPage />);

        fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/system-status/unsynced-scans/5",
            expect.objectContaining({ method: "POST" }),
        );
        expect(await screen.findByText("● No scans awaiting review.")).toBeInTheDocument();
    });

    it("shows an empty state when nothing is awaiting review", async () => {
        mockFetchJson({ "/api/system-status/unsynced-scans": { scans: [] } });
        renderWithProviders(<SystemStatusUnsyncedScansPage />);

        expect(await screen.findByText("● No scans awaiting review.")).toBeInTheDocument();
    });
});
