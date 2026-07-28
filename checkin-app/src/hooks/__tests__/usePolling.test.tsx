import { act, renderHook } from "@testing-library/react";
import { usePolling } from "../usePolling";

function setVisibility(state: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
}

describe("usePolling", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        setVisibility("visible");
    });
    afterEach(() => {
        jest.useRealTimers();
        setVisibility("visible");
    });

    it("fires once on mount then on the interval", () => {
        const fn = jest.fn();
        renderHook(() => usePolling(fn, 1000));
        expect(fn).toHaveBeenCalledTimes(1); // immediate
        act(() => { jest.advanceTimersByTime(3000); });
        expect(fn).toHaveBeenCalledTimes(4);
    });

    it("pauses while hidden and fires once + resumes on re-show", () => {
        const fn = jest.fn();
        renderHook(() => usePolling(fn, 1000));
        expect(fn).toHaveBeenCalledTimes(1);

        act(() => { setVisibility("hidden"); });
        act(() => { jest.advanceTimersByTime(5000); });
        expect(fn).toHaveBeenCalledTimes(1); // no ticks while hidden

        act(() => { setVisibility("visible"); });
        expect(fn).toHaveBeenCalledTimes(2); // fired once on re-show
        act(() => { jest.advanceTimersByTime(2000); });
        expect(fn).toHaveBeenCalledTimes(4); // interval resumed
    });

    it("idle-stops after idleStopMs, then resumes + fires once on activity", () => {
        const fn = jest.fn();
        renderHook(() => usePolling(fn, 1000, { idleStopMs: 10_000 }));
        expect(fn).toHaveBeenCalledTimes(1);

        act(() => { jest.advanceTimersByTime(10_000); }); // 10 ticks, then idle-stop fires
        const atStop = fn.mock.calls.length;
        act(() => { jest.advanceTimersByTime(5000); });
        expect(fn).toHaveBeenCalledTimes(atStop); // stopped — no more ticks

        act(() => { window.dispatchEvent(new Event("pointerdown")); });
        expect(fn).toHaveBeenCalledTimes(atStop + 1); // resumed + refreshed
        act(() => { jest.advanceTimersByTime(2000); });
        expect(fn).toHaveBeenCalledTimes(atStop + 3);
    });

    it("without idleStopMs it never idle-stops", () => {
        const fn = jest.fn();
        renderHook(() => usePolling(fn, 1000));
        act(() => { jest.advanceTimersByTime(60_000); });
        expect(fn.mock.calls.length).toBeGreaterThan(50);
    });

    it("stops all timers on unmount", () => {
        const fn = jest.fn();
        const { unmount } = renderHook(() => usePolling(fn, 1000, { idleStopMs: 10_000 }));
        act(() => { jest.advanceTimersByTime(1000); });
        const before = fn.mock.calls.length;
        unmount();
        act(() => { jest.advanceTimersByTime(10_000); });
        expect(fn).toHaveBeenCalledTimes(before);
    });
});
