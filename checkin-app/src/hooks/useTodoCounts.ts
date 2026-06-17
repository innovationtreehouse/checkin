"use client";

import { useCallback, useEffect, useState } from "react";
import { NAV_COUNTS_EVENT } from "@/lib/nav-refresh";
import type { TodoCounts } from "@/app/api/nav/todo-counts/route";

/**
 * Fetch nav todo-count badges and keep them live. Refetches on mount and whenever
 * a mutation site fires NAV_COUNTS_EVENT (see src/lib/nav-refresh.ts). Returns null
 * until the first response (so callers render no badge), and when disabled.
 */
export function useTodoCounts(enabled: boolean): TodoCounts | null {
    const [counts, setCounts] = useState<TodoCounts | null>(null);

    // Kept as a .then chain (not async/await) so the setState lands in a callback
    // — the effect body never sets state synchronously.
    const fetchCounts = useCallback(() => {
        fetch("/api/nav/todo-counts")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data) setCounts(data as TodoCounts);
            })
            .catch(() => {
                // Badges are best-effort; a failed fetch just leaves the last value.
            });
    }, []);

    useEffect(() => {
        if (enabled) {
            fetchCounts();
            const handler = () => fetchCounts();
            window.addEventListener(NAV_COUNTS_EVENT, handler);
            return () => window.removeEventListener(NAV_COUNTS_EVENT, handler);
        }
    }, [enabled, fetchCounts]);

    // When disabled (e.g. signed out) report no counts rather than a stale value.
    return enabled ? counts : null;
}
