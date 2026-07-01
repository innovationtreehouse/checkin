// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { redirect } from "next/navigation";
import { renderWithProviders, resetRtl } from "@/test-helpers/rtl";
import SystemStatusIndex from "../page";

beforeEach(() => resetRtl());

describe("SystemStatusIndex", () => {
    it("redirects to /system-status/health", () => {
        renderWithProviders(<SystemStatusIndex />);
        expect(redirect).toHaveBeenCalledWith("/system-status/health");
    });
});
