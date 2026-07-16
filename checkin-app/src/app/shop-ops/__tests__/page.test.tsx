// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next/navigation", () => require("@/test-helpers/rtl").navMock());
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock("next-auth/react", () => require("@/test-helpers/rtl").authMock());
import { renderWithProviders, setSession, resetRtl, router } from "@/test-helpers/rtl";
import ShopOpsIndex from "../page";

beforeEach(() => resetRtl());

describe("ShopOpsIndex", () => {
    it("redirects a certifier to /shop-ops/manage", async () => {
        setSession({ id: 1, isSysadmin: true });
        renderWithProviders(<ShopOpsIndex />);

        await Promise.resolve();
        expect(router.replace).toHaveBeenCalledWith("/shop-ops/manage");
    });

    it("redirects a non-certifier to /shop-ops/live", async () => {
        setSession({ id: 2 });
        renderWithProviders(<ShopOpsIndex />);

        await Promise.resolve();
        expect(router.replace).toHaveBeenCalledWith("/shop-ops/live");
    });
});
