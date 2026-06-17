/** Parse a Shopify ISO-8601 timestamp into a Date, or null when absent/blank. */
export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Extract the numeric legacy id from a Shopify GID, e.g. gid://shopify/Order/123 -> "123". */
export function legacyIdFromGid(gid: string): string | undefined {
  const m = /\/(\d+)(?:\?.*)?$/.exec(gid);
  return m ? m[1] : undefined;
}
