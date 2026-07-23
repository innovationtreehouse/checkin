// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { redirect } from "next/navigation";
import { resetRtl } from "@/test-helpers/rtl";
import { MEMBERSHIP_OPS_NAV_LINKS } from "@/lib/membershipOpsNav";
import MembershipOpsIndex from "../page";

beforeEach(() => resetRtl());

describe("membership-ops index page", () => {
  it("redirects to the first nav link", () => {
    MembershipOpsIndex();
    expect(redirect).toHaveBeenCalledWith(MEMBERSHIP_OPS_NAV_LINKS[0].href);
  });
});
