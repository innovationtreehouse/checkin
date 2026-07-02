// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { redirect } from "next/navigation";
import { resetRtl } from "@/test-helpers/rtl";
import MyProgramsIndex from "../page";

beforeEach(() => resetRtl());

describe("MyProgramsIndex", () => {
  it("redirects to /my-programs/attendance", () => {
    // Sync redirect-only server component (returns void) — call it, don't render as JSX.
    MyProgramsIndex();
    expect(redirect).toHaveBeenCalledWith("/my-programs/attendance");
  });
});
