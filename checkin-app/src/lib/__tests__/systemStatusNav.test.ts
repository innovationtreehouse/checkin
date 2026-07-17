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

  it("flags only Audit Log as sysadmin-only", () => {
    const sysadminOnly = SYSTEM_STATUS_NAV_LINKS.filter((l) => l.sysadminOnly).map((l) => l.name);
    expect(sysadminOnly).toEqual(["Audit Log"]);
  });

  it("leaves the other tabs visible to everyone (sysadminOnly unset)", () => {
    const everyone = SYSTEM_STATUS_NAV_LINKS.filter((l) => !l.sysadminOnly).map((l) => l.name);
    expect(everyone).toEqual(["System Status", "Link Status", "Lifecycle", "Errors"]);
  });
});
