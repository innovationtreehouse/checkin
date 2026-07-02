/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { redirect } from "next/navigation";
import { resetRtl } from "@/test-helpers/rtl";
import MyActivitiesIndex from "../page";

beforeEach(() => resetRtl());

// Server Component: `redirect()` throws in real Next.js (the mock doesn't), and
// the function has no JSX after the call — so this calls it directly rather
// than rendering it, same pattern used for the other bare-redirect hub pages.
describe("my-activities index page", () => {
    it("redirects to /my-activities/events", () => {
        MyActivitiesIndex();
        expect(redirect).toHaveBeenCalledWith("/my-activities/events");
    });
});
