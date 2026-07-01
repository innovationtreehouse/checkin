// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());

import { redirect } from "next/navigation";
import { resetRtl } from "@/test-helpers/rtl";
import FacilityOpsIndex from "../page";

beforeEach(() => resetRtl());

describe("facility-ops index page", () => {
  it("redirects to the visits tab", () => {
    expect(() => FacilityOpsIndex()).not.toThrow();
    expect(redirect).toHaveBeenCalledWith("/facility-ops/visits");
  });
});
