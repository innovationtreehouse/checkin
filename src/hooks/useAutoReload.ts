import { useEffect, useRef } from "react";

/**
 * Poll /api/version and reload the page when the server version changes
 * (i.e. after a deploy / server restart).
 *
 * @param intervalMs  How often to check (default 30 s)
 */
export function useAutoReload(intervalMs = 30_000) {
    const knownVersion = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const res = await fetch("/api/version", { cache: "no-store" });
                if (!res.ok) return;
                const data: { version: string } = await res.json();

                if (knownVersion.current === null) {
                    // First fetch — just record the baseline
                    knownVersion.current = data.version;
                } else if (data.version !== knownVersion.current) {
                    // Version changed — server was restarted
                    if (!cancelled) {
                        window.location.reload();
                    }
                }
            } catch {
                // Network blip — ignore, we'll retry next interval
            }
        };

        // Initial check
        check();

        const timer = setInterval(check, intervalMs);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [intervalMs]);
}
