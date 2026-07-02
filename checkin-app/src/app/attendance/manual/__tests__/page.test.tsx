/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { screen, fireEvent } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, mockFetchJson, setSession, resetRtl } from "@/test-helpers/rtl";
import ManualAttendance from "../page";

beforeEach(() => resetRtl());

describe("ManualAttendance", () => {
    it("records a manual visit and shows a success message", async () => {
        setSession({ id: 1 });
        mockFetchJson({ "/api/attendance/manual": { ok: true } });
        renderWithProviders(<ManualAttendance />);

        const submit = screen.getByRole("button", { name: "Record Time Entry" });
        expect(submit).toBeDisabled();

        // "required" adds a visually-hidden "*" to the label text, so match by substring.
        fireEvent.change(screen.getByLabelText(/Arrival Time/), { target: { value: "2026-06-01T10:00" } });
        fireEvent.click(submit);

        expect(await screen.findByText("Visit recorded successfully.")).toBeInTheDocument();
    });

    it("shows an error message when the API rejects the entry", async () => {
        setSession({ id: 1 });
        mockFetchJson({}); // unmatched route -> 404, no body.error
        renderWithProviders(<ManualAttendance />);

        // "required" adds a visually-hidden "*" to the label text, so match by substring.
        fireEvent.change(screen.getByLabelText(/Arrival Time/), { target: { value: "2026-06-01T10:00" } });
        fireEvent.click(screen.getByRole("button", { name: "Record Time Entry" }));

        expect(await screen.findByText("Failed to record manual visit.")).toBeInTheDocument();
    });
});
