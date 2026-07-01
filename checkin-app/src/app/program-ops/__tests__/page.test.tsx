// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());

import { redirect } from "next/navigation";
import ProgramOpsIndex from "../page";

beforeEach(() => (redirect as unknown as jest.Mock).mockClear());

describe("ProgramOpsIndex", () => {
  it("redirects to the programs list", () => {
    ProgramOpsIndex();
    expect(redirect).toHaveBeenCalledWith("/program-ops/programs");
  });
});
