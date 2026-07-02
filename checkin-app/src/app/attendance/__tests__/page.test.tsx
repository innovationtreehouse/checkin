/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
import { waitFor } from "@testing-library/react";
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, setSearchParams, router, resetRtl } from "@/test-helpers/rtl";
import AttendanceIndex from "../page";

beforeEach(() => resetRtl());

describe("AttendanceIndex", () => {
    it("redirects to /attendance/current", async () => {
        renderWithProviders(<AttendanceIndex />);
        await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/attendance/current"));
    });

    it("preserves kiosk signature query params on redirect", async () => {
        setSearchParams("mode=kiosk&sig=abc&ts=1&nonce=xyz");
        renderWithProviders(<AttendanceIndex />);
        await waitFor(() =>
            expect(router.replace).toHaveBeenCalledWith("/attendance/current?mode=kiosk&sig=abc&ts=1&nonce=xyz"),
        );
    });
});
