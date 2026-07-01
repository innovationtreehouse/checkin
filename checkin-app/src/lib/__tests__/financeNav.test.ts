import { FINANCE_NAV_LINKS } from "../financeNav";

describe("FINANCE_NAV_LINKS", () => {
  it("is a non-empty list of nav links with name, href, and icon", () => {
    expect(FINANCE_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of FINANCE_NAV_LINKS) {
      expect(typeof link.name).toBe("string");
      expect(link.href.startsWith("/finance-ops/")).toBe(true);
      expect(typeof link.icon).toBe("string");
    }
  });

  it("has unique hrefs", () => {
    const hrefs = FINANCE_NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
