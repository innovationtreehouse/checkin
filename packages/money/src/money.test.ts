import { describe, it, expect } from "vitest";
import { dollarsToCents, dollarsToCentsOrNull, sumCents, formatCents, formatUSD, formatCurrency } from "./index";

describe("dollarsToCents", () => {
  it("converts whole dollar string", () => expect(dollarsToCents("100")).toBe(10000));
  it("converts decimal dollar string", () => expect(dollarsToCents("123.45")).toBe(12345));
  it("converts number input", () => expect(dollarsToCents(99.99)).toBe(9999));
  it("converts zero", () => { expect(dollarsToCents("0")).toBe(0); expect(dollarsToCents(0)).toBe(0); });
  it("converts negative value", () => expect(dollarsToCents("-50.00")).toBe(-5000));
  it("absorbs float representation errors", () => {
    expect(dollarsToCents("10.10")).toBe(1010);
    expect(dollarsToCents(10.1)).toBe(1010);
  });
  it("handles large amounts without overflow", () => expect(dollarsToCents("999999.99")).toBe(99999999));
  it("converts string '0.00'", () => expect(dollarsToCents("0.00")).toBe(0));
  it("converts empty string to 0 (Number('') === 0)", () => expect(dollarsToCents("")).toBe(0));
  it("throws on NaN string", () => expect(() => dollarsToCents("N/A")).toThrow("Invalid monetary value"));
  it("throws on Infinity", () => expect(() => dollarsToCents(Infinity)).toThrow("Invalid monetary value"));
  it("throws on NaN number", () => expect(() => dollarsToCents(NaN)).toThrow("Invalid monetary value"));
});

describe("dollarsToCentsOrNull", () => {
  it("converts positive amount", () => expect(dollarsToCentsOrNull("1.00")).toBe(100));
  it("converts fractional amount", () => expect(dollarsToCentsOrNull("0.99")).toBe(99));
  it("converts negative amount", () => expect(dollarsToCentsOrNull("-3.00")).toBe(-300));
  it("converts zero to 0 (not null)", () => expect(dollarsToCentsOrNull("0")).toBe(0));
  it("converts large amount", () => expect(dollarsToCentsOrNull("999999.99")).toBe(99999999));
  it("returns null for empty string", () => expect(dollarsToCentsOrNull("")).toBeNull());
  it("returns null for whitespace", () => expect(dollarsToCentsOrNull("   ")).toBeNull());
  it("returns null for undefined", () => expect(dollarsToCentsOrNull(undefined)).toBeNull());
  it("returns null for non-numeric string", () => expect(dollarsToCentsOrNull("abc")).toBeNull());
});

describe("sumCents", () => {
  it("sums two amounts", () => expect(sumCents(100, 200)).toBe(300));
  it("sums zero amounts", () => expect(sumCents(0, 0, 0)).toBe(0));
  it("sums single amount", () => expect(sumCents(500)).toBe(500));
  it("sums many amounts", () => expect(sumCents(10, 10, 10)).toBe(30));
  it("sums negative amounts", () => expect(sumCents(1000, -250)).toBe(750));
  it("returns 0 for no arguments", () => expect(sumCents()).toBe(0));
});

describe("formatCents", () => {
  it("formats whole dollars", () => expect(formatCents(10000)).toBe("$100.00"));
  it("formats cents", () => expect(formatCents(10050)).toBe("$100.50"));
  it("formats single cent", () => expect(formatCents(1)).toBe("$0.01"));
  it("formats zero", () => expect(formatCents(0)).toBe("$0.00"));
  it("formats negative value with leading minus", () => expect(formatCents(-5000)).toBe("-$50.00"));
  it("pads cents below 10 to two digits", () => expect(formatCents(509)).toBe("$5.09"));
  it("formats large amount", () => expect(formatCents(99999999)).toBe("$999999.99"));
});

describe("formatUSD", () => {
  it("formats a positive cents value", () => expect(formatUSD(10000)).toBe("$100.00"));
  it("formats sub-dollar cents", () => { expect(formatUSD(100)).toBe("$1.00"); expect(formatUSD(5)).toBe("$0.05"); });
  it("formats zero", () => expect(formatUSD(0)).toBe("$0.00"));
  it("formats negative cents", () => expect(formatUSD(-2550)).toBe("-$25.50"));
  it("returns em-dash for null", () => expect(formatUSD(null)).toBe("—"));
  it("returns em-dash for undefined", () => expect(formatUSD(undefined)).toBe("—"));
});

describe("formatCurrency", () => {
  it("formats USD dollars", () => expect(formatCurrency(1234.5, "USD")).toBe("$1,234.50"));
  it("formats EUR", () => expect(formatCurrency(0, "EUR")).toBe("€0.00"));
  it("defaults to USD for empty currency", () => expect(formatCurrency(9.9, "")).toBe("$9.90"));
  it("formats negative USD", () => expect(formatCurrency(-50, "USD")).toBe("-$50.00"));
});
