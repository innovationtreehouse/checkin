import { describe, it, expect } from "vitest";
import { toCents, moneyV2ToCents } from "../../src/money.js";

describe("toCents", () => {
  it("parses decimal strings to integer cents", () => {
    expect(toCents("12.34")).toBe(1234);
    expect(toCents("100.00")).toBe(10000);
  });

  it("keeps negatives signed (refunds/adjustments)", () => {
    expect(toCents("-20.00")).toBe(-2000);
    expect(toCents(-4.5)).toBe(-450);
  });

  it("treats null/blank/undefined as zero", () => {
    expect(toCents(null)).toBe(0);
    expect(toCents(undefined)).toBe(0);
    expect(toCents("")).toBe(0);
  });

  it("avoids binary float drift", () => {
    expect(toCents("0.07")).toBe(7);
    expect(toCents(12.34)).toBe(1234);
  });

  it("throws on non-numeric input", () => {
    expect(() => toCents("abc")).toThrow();
  });

  it("reads MoneyV2 shapes", () => {
    expect(moneyV2ToCents({ amount: "-4.50" })).toBe(-450);
    expect(moneyV2ToCents(null)).toBe(0);
  });
});
