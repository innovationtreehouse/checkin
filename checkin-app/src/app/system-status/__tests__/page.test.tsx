// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { redirect } from "next/navigation";
import { resetRtl } from "@/test-helpers/rtl";
import SystemStatusIndex from "../page";

beforeEach(() => resetRtl());

describe("SystemStatusIndex", () => {
    it("redirects to /system-status/health", () => {
        // Sync redirect-only server component (returns void) — call it, don't render as JSX.
        SystemStatusIndex();
        expect(redirect).toHaveBeenCalledWith("/system-status/health");
    });
});
