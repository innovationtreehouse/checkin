import { SYSTEM_STATUS_NAV_LINKS } from "../systemStatusNav";

describe("SYSTEM_STATUS_NAV_LINKS", () => {
  it("is a non-empty list of nav links with name and href", () => {
    expect(SYSTEM_STATUS_NAV_LINKS.length).toBeGreaterThan(0);
    for (const link of SYSTEM_STATUS_NAV_LINKS) {
      expect(typeof link.name).toBe("string");
      expect(link.href.startsWith("/system-status/")).toBe(true);
    }
  });

  it("has unique hrefs", () => {
    const hrefs = SYSTEM_STATUS_NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  // Every tab, Audit Log included, is open to the whole section audience
  // (sysadmin + board) — the layout filters nothing.
  it("exposes every tab to the section audience", () => {
    expect(SYSTEM_STATUS_NAV_LINKS.map((l) => l.name)).toEqual([
      "System Status",
      "Link Status",
      "Lifecycle",
      "Errors",
      "Audit Log",
    ]);
  });
});
