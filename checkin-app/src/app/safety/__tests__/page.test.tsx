// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());

import { redirect } from "next/navigation";
import { resetRtl } from "@/test-helpers/rtl";
import SafetyIndex from "../page";

beforeEach(() => resetRtl());

describe("safety index page", () => {
  it("redirects to the emergency-contacts tab", () => {
    // The mocked redirect() is a no-op jest.fn(), unlike the real one (which throws
    // to abort rendering), so the component falls through to an implicit `return
    // undefined` afterward — invalid for React, hence the render throws too.
    expect(() => SafetyIndex()).not.toThrow();
    expect(redirect).toHaveBeenCalledWith("/safety/emergency-contacts");
  });
});
