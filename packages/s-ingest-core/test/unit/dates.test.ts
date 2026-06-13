/**
 * Pure unit tests for the date / GID helpers. Both feed watermarks and the raw-log
 * metadata, so their null / no-match branches matter.
 */
import { describe, it, expect } from "vitest";
import { parseDate, legacyIdFromGid } from "../../src/dates.js";

describe("parseDate", () => {
  it("parses an ISO-8601 timestamp into a Date", () => {
    const d = parseDate("2026-02-01T10:00:00Z");
    expect(d).toBeInstanceOf(Date);
    expect(d?.toISOString()).toBe("2026-02-01T10:00:00.000Z");
  });

  it("returns null for null / undefined / blank", () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("returns null for an unparseable string rather than an Invalid Date", () => {
    expect(parseDate("not-a-date")).toBeNull();
  });
});

describe("legacyIdFromGid", () => {
  it("extracts the trailing numeric id", () => {
    expect(legacyIdFromGid("gid://shopify/Order/1234")).toBe("1234");
    expect(legacyIdFromGid("gid://shopify/ShopifyPaymentsPayout/5001")).toBe("5001");
  });

  it("ignores a trailing query string", () => {
    expect(legacyIdFromGid("gid://shopify/Order/1234?foo=bar")).toBe("1234");
  });

  it("returns undefined when there is no trailing numeric id", () => {
    expect(legacyIdFromGid("gid://shopify/Order/abc")).toBeUndefined();
    expect(legacyIdFromGid("not-a-gid")).toBeUndefined();
  });
});
