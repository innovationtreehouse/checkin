import { screen, fireEvent } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import SystemStatusLinksPage from "../page";

beforeEach(() => resetRtl());

describe("SystemStatusLinksPage", () => {
    it("lists integration errors and resolves one", async () => {
        mockFetchJson({
            "/api/system-status/links": {
                errors: [{ id: 1, source: "Shopify", message: "webhook failed", context: null, timestamp: new Date().toISOString(), resolvedAt: null }],
            },
        });
        renderWithProviders(<SystemStatusLinksPage />);

        expect(await screen.findByText("webhook failed")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: /mark resolved/i }));
        // toggleResolved re-fetches after the PATCH; both calls route through the same mock.
        expect(await screen.findByText("webhook failed")).toBeInTheDocument();
    });

    it("shows an empty state when there are no link errors", async () => {
        mockFetchJson({ "/api/system-status/links": { errors: [] } });
        renderWithProviders(<SystemStatusLinksPage />);

        expect(await screen.findByText("● No integration errors logged.")).toBeInTheDocument();
    });
});
