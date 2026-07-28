import { MEMBERSHIP_OPS_NAV_LINKS } from "../membershipOpsNav";

describe("MEMBERSHIP_OPS_NAV_LINKS", () => {
  it("is a non-empty list of nav links with name, href, and icon", () => {
    expect(MEMBERSHIP_OPS_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of MEMBERSHIP_OPS_NAV_LINKS) {
      expect(typeof link.name).toBe("string");
      expect(link.href.startsWith("/membership-ops/")).toBe(true);
      expect(typeof link.icon).toBe("string");
    }
  });

  it("has unique hrefs", () => {
    const hrefs = MEMBERSHIP_OPS_NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("surfaces the Merge Participants tool now that the merge route deletes nothing", () => {
    expect(MEMBERSHIP_OPS_NAV_LINKS.some((l) => l.href.includes("merge"))).toBe(true);
  });
});
