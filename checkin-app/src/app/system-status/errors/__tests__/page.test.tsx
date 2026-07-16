import { screen } from "@testing-library/react";
import { renderWithProviders, mockFetchJson, resetRtl } from "@/test-helpers/rtl";
import SystemStatusErrorsPage from "../page";

beforeEach(() => resetRtl());

describe("SystemStatusErrorsPage", () => {
    it("lists backend error log entries", async () => {
        mockFetchJson({
            "/api/system-status/errors": {
                errors: [{ id: 1, timestamp: new Date().toISOString(), route: "/api/foo", message: "boom", stack: null, context: null }],
            },
        });
        renderWithProviders(<SystemStatusErrorsPage />);

        expect(await screen.findByText("boom")).toBeInTheDocument();
        expect(screen.getByText("/api/foo")).toBeInTheDocument();
    });

    it("shows an empty state when there are no errors", async () => {
        mockFetchJson({ "/api/system-status/errors": { errors: [] } });
        renderWithProviders(<SystemStatusErrorsPage />);

        expect(await screen.findByText("● No backend errors logged.")).toBeInTheDocument();
    });
});
