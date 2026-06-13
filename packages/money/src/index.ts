/**
 * Money is represented everywhere as INTEGER MINOR UNITS (cents).
 * Never use floats for money. All conversion and arithmetic goes through here.
 */

/** Parse a dollar string/number (e.g. "123.45", 123.45) into integer cents. Throws on NaN/Infinity. */
export function dollarsToCents(value: string | number): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) throw new Error(`Invalid monetary value: ${value}`);
  return Math.round(n * 100);
}

/** Parse a dollar string into integer cents. Returns null for empty/missing/invalid input. */
export function dollarsToCentsOrNull(value: string | undefined): number | null {
  if (!value || value.trim() === "") return null;
  const n = parseFloat(value);
  if (isNaN(n)) return null;
  return Math.round(n * 100);
}

/** Sum integer-cent amounts. Inputs must already be integer cents. */
export function sumCents(...amounts: number[]): number {
  return amounts.reduce((acc, n) => acc + n, 0);
}

/** Format integer cents as a USD display string, e.g. 10050 -> "$100.50". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  return `${sign}$${dollars}.${remainder}`;
}

/** Format integer cents as USD for display. Returns "—" for null/undefined. */
export function formatUSD(val: number | null | undefined): string {
  if (val == null) return "—";
  return formatCents(val);
}

/** Format an amount using Intl.NumberFormat. Amount is in the natural unit for the currency (dollars for USD). */
export function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
