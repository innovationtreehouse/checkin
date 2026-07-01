import { PROGRAM_NAV_LINKS } from "../programNav";

describe("PROGRAM_NAV_LINKS", () => {
  it("is a non-empty list of nav links with name, href, and icon", () => {
    expect(PROGRAM_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of PROGRAM_NAV_LINKS) {
      expect(typeof link.name).toBe("string");
      expect(link.href.startsWith("/program-ops/")).toBe(true);
      expect(typeof link.icon).toBe("string");
    }
  });

  it("has unique hrefs", () => {
    const hrefs = PROGRAM_NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
