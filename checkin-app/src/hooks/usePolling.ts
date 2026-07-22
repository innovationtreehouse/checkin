import { useEffect, useRef } from "react";

/**
 * Interval poller that stops burning server/DB round-trips when nobody is looking.
 *
 * Both guards exist so checkin's scale-to-zero infra can actually sleep: a
 * left-open tab polling a DB-backed route every N seconds pins Aurora awake
 * (it pauses only after ~5 min with zero queries), and when the request carries
 * a session cookie it also re-wakes a curfewed prod via the waker's cookie
 * wake-gate — so the overnight teardown never sticks.
 *
 *   - pauseWhenHidden (default true): no ticks while the tab is hidden; on
 *     re-show, fire once immediately (data went stale) then resume the interval.
 *   - idleStopMs (opt-in): after this long with no user input, stop entirely;
 *     the next interaction resumes and fires once. Leave UNSET for an unattended
 *     display — a wall kiosk has no input and must not freeze.
 *
 * fn is kept in a ref, so passing a fresh closure each render does not reset the
 * timers. SSR-safe: no-op until document/window exist.
 */
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "mousemove", "scroll", "touchstart"] as const;

export function usePolling(
    fn: () => void,
    intervalMs: number,
    opts: { pauseWhenHidden?: boolean; idleStopMs?: number } = {},
): void {
    const { pauseWhenHidden = true, idleStopMs } = opts;
    const fnRef = useRef(fn);
    useEffect(() => { fnRef.current = fn; });

    useEffect(() => {
        if (typeof document === "undefined") return;

        let interval: ReturnType<typeof setInterval> | null = null;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;
        let idleStopped = false;

        const tick = () => fnRef.current();

        const start = (fireNow: boolean) => {
            if (idleStopped) return;
            if (pauseWhenHidden && document.visibilityState !== "visible") return;
            if (fireNow) tick();
            if (interval === null) interval = setInterval(tick, intervalMs);
        };

        const stop = () => {
            if (interval !== null) {
                clearInterval(interval);
                interval = null;
            }
        };

        const armIdle = () => {
            if (idleStopMs === undefined) return;
            if (idleTimer !== null) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
                idleStopped = true;
                stop();
            }, idleStopMs);
        };

        const onActivity = () => {
            if (idleStopped) {
                idleStopped = false;
                start(true); // resume + refresh
            }
            armIdle();
        };

        const onVisibility = () => {
            if (document.visibilityState === "visible") start(true);
            else stop();
        };

        start(true);
        armIdle();

        if (pauseWhenHidden) document.addEventListener("visibilitychange", onVisibility);
        if (idleStopMs !== undefined) {
            for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { passive: true });
        }

        return () => {
            stop();
            if (idleTimer !== null) clearTimeout(idleTimer);
            if (pauseWhenHidden) document.removeEventListener("visibilitychange", onVisibility);
            if (idleStopMs !== undefined) {
                for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity);
            }
        };
    }, [intervalMs, pauseWhenHidden, idleStopMs]);
}

/** Default idle-stop for attended staff views. Tune if it proves too eager. */
export const POLL_IDLE_STOP_MS = 10 * 60 * 1000;
