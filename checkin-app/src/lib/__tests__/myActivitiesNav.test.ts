import { MY_ACTIVITIES_NAV_LINKS } from "../myActivitiesNav";

describe("MY_ACTIVITIES_NAV_LINKS", () => {
  it("is a non-empty list of nav links with name, href, and icon", () => {
    expect(MY_ACTIVITIES_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of MY_ACTIVITIES_NAV_LINKS) {
      expect(typeof link.name).toBe("string");
      expect(link.href.startsWith("/my-activities/")).toBe(true);
      expect(typeof link.icon).toBe("string");
    }
  });

  it("has unique hrefs", () => {
    const hrefs = MY_ACTIVITIES_NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
