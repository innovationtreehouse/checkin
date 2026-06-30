import { intervalsOverlap, clusterOverlapping, type Interval } from "@/lib/attendanceConflicts";

const at = (h: number) => new Date(`2026-06-29T${String(h).padStart(2, "0")}:00:00Z`);
const v = (arrived: number, departed: number | null): Interval => ({
  arrivedAt: at(arrived),
  departedAt: departed === null ? null : at(departed),
});

describe("intervalsOverlap (half-open, null = +infinity)", () => {
  it("flags genuinely overlapping intervals", () => {
    expect(intervalsOverlap(v(10, 14), v(12, 16))).toBe(true);
  });

  it("flags a contained interval", () => {
    expect(intervalsOverlap(v(10, 18), v(12, 14))).toBe(true);
  });

  it("flags an OPEN visit (departedAt=null) against a later visit", () => {
    // [10, +inf) overlaps [12, 14)
    expect(intervalsOverlap(v(10, null), v(12, 14))).toBe(true);
    // order-independent
    expect(intervalsOverlap(v(12, 14), v(10, null))).toBe(true);
  });

  it("flags two open visits", () => {
    expect(intervalsOverlap(v(10, null), v(12, null))).toBe(true);
  });

  it("does NOT flag boundary-touching intervals (back-to-back)", () => {
    // [10, 12) and [12, 14) merely touch at 12
    expect(intervalsOverlap(v(10, 12), v(12, 14))).toBe(false);
    expect(intervalsOverlap(v(12, 14), v(10, 12))).toBe(false);
  });

  it("does NOT flag an open visit that starts exactly when the earlier one ends", () => {
    // [10, 12) and [12, +inf) touch at 12 — legitimate back-to-back
    expect(intervalsOverlap(v(10, 12), v(12, null))).toBe(false);
  });

  it("does NOT flag disjoint intervals (left and came back)", () => {
    expect(intervalsOverlap(v(10, 11), v(13, 15))).toBe(false);
  });
});

describe("clusterOverlapping", () => {
  it("returns no cluster for disjoint visits", () => {
    expect(clusterOverlapping([v(10, 11), v(13, 15)])).toEqual([]);
  });

  it("returns no cluster for back-to-back (boundary-touching) visits", () => {
    expect(clusterOverlapping([v(10, 12), v(12, 14)])).toEqual([]);
  });

  it("groups two overlapping visits into one cluster", () => {
    const out = clusterOverlapping([v(10, 14), v(12, 16)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });

  it("groups an open visit with a later overlapping visit", () => {
    const out = clusterOverlapping([v(10, null), v(12, 14)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });

  it("is transitive: A∩B, B∩C with A,C disjoint still forms one cluster", () => {
    const out = clusterOverlapping([v(10, 14), v(13, 18), v(16, 20)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(3);
  });

  it("separates an overlapping pair from a later disjoint visit", () => {
    const out = clusterOverlapping([v(10, 14), v(12, 16), v(20, 22)]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
  });

  it("is order-independent (sorts internally)", () => {
    const out = clusterOverlapping([v(12, 16), v(10, 14)]);
    expect(out).toHaveLength(1);
  });
});
