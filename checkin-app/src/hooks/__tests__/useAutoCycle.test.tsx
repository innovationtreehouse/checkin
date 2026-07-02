import { act, renderHook } from "@testing-library/react";
import { useAutoCycle } from "../useAutoCycle";

describe("useAutoCycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("starts on page 0 with a ref and no transition", () => {
    const { result } = renderHook(() => useAutoCycle({ items: ["a", "b", "c"] }));
    expect(result.current.containerRef.current).toBeNull();
    expect(result.current.currentPage).toBe(0);
    expect(result.current.isTransitioning).toBe(false);
    expect(result.current.visibleItems).toEqual(["a"]);
  });

  it("does not cycle when everything fits on one page", () => {
    const { result } = renderHook(() => useAutoCycle({ items: ["only"], intervalMs: 1000 }));
    act(() => {
      jest.advanceTimersByTime(10000);
    });
    expect(result.current.currentPage).toBe(0);
    expect(result.current.totalPages).toBe(1);
  });

  it("returns no visible items for an empty list", () => {
    const { result } = renderHook(() => useAutoCycle({ items: [] }));
    expect(result.current.totalPages).toBe(0);
    expect(result.current.visibleItems).toEqual([]);
  });

  it("advances through pages on the interval, fading out then in", () => {
    const { result } = renderHook(() => useAutoCycle({ items: ["a", "b", "c"], intervalMs: 1000 }));
    expect(result.current.totalPages).toBe(3);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current.isTransitioning).toBe(true);
    expect(result.current.currentPage).toBe(0);

    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current.isTransitioning).toBe(false);
    expect(result.current.currentPage).toBe(1);
    expect(result.current.visibleItems).toEqual(["b"]);

    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(result.current.currentPage).toBe(2);

    // Wraps back to the first page after the last one.
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(result.current.currentPage).toBe(0);
  });
});
