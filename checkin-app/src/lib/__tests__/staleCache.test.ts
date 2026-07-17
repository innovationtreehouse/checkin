import { staleWhileRevalidate, clearStaleCache } from "@/lib/staleCache";

beforeEach(() => clearStaleCache());

describe("staleWhileRevalidate", () => {
    it("computes on miss and serves fresh within the window", async () => {
        const fn = jest.fn().mockResolvedValue("v1");
        expect(await staleWhileRevalidate("k", 1000, fn)).toEqual({ value: "v1", stale: false });
        expect(await staleWhileRevalidate("k", 1000, fn)).toEqual({ value: "v1", stale: false });
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("serves stale instantly past the window and revalidates once in the background", async () => {
        jest.useFakeTimers();
        const fn = jest.fn().mockResolvedValue("v1");
        await staleWhileRevalidate("k", 1000, fn);
        jest.advanceTimersByTime(1500);
        fn.mockResolvedValue("v2");
        // Two concurrent expired reads: both get stale v1, ONE background refresh.
        const [a, b] = await Promise.all([
            staleWhileRevalidate("k", 1000, fn),
            staleWhileRevalidate("k", 1000, fn),
        ]);
        expect(a).toEqual({ value: "v1", stale: true });
        expect(b).toEqual({ value: "v1", stale: true });
        expect(fn).toHaveBeenCalledTimes(2); // initial + one deduped revalidation
        await Promise.resolve(); await Promise.resolve(); // let the refresh settle
        expect(await staleWhileRevalidate("k", 1000, fn)).toEqual({ value: "v2", stale: false });
        jest.useRealTimers();
    });

    it("serves stale at ANY age when the compute fails (the Aurora-resume case)", async () => {
        jest.useFakeTimers();
        const fn = jest.fn().mockResolvedValue("v1");
        await staleWhileRevalidate("k", 1000, fn);
        jest.advanceTimersByTime(60 * 60 * 1000); // an hour stale
        fn.mockRejectedValue(new Error("timeout exceeded when trying to connect"));
        expect(await staleWhileRevalidate("k", 1000, fn)).toEqual({ value: "v1", stale: true });
        jest.useRealTimers();
    });

    it("propagates the failure when there is no cache to fall back on", async () => {
        const fn = jest.fn().mockRejectedValue(new Error("boom"));
        await expect(staleWhileRevalidate("k", 1000, fn)).rejects.toThrow("boom");
    });
});
