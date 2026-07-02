// eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories run hoisted, before imports exist
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());

import { redirect } from "next/navigation";
import { resetRtl } from "@/test-helpers/rtl";
import FinanceOpsIndex from "../page";

beforeEach(() => resetRtl());

describe("finance-ops index page", () => {
  it("redirects to the payment-plan tab", () => {
    expect(() => FinanceOpsIndex()).not.toThrow();
    expect(redirect).toHaveBeenCalledWith("/finance-ops/payment-plan");
  });
});
