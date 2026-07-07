"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Alert, Group, Loader, Text } from "@mantine/core";

/**
 * Surfaces the shared Aurora cluster's auto-pause resume (~30s) instead of
 * letting a cold visit read as a broken app. One probe per hard page load
 * (this sits in the root layout, which persists across client navigations):
 * if /api/health/db reports waking — or doesn't answer within the probe
 * timeout, which is what a stalled auth/DB layer looks like — show a banner
 * and poll until the DB answers, then hard-reload so any requests that
 * failed or stalled during the wake re-run cleanly.
 *
 * Probes only when authenticated, mirroring the endpoint's session gate (an
 * anonymous probe would let crawlers keep waking the cluster).
 */
const PROBE_TIMEOUT_MS = 2_500;
const POLL_INTERVAL_MS = 3_000;

/** Indirection only for tests: jsdom forbids overriding window.location.reload. */
export const hardReload = { fn: () => window.location.reload() };

async function probeOnce(): Promise<"ok" | "waking" | "unknown"> {
    try {
        const res = await fetch("/api/health/db", {
            cache: "no-store",
            signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        });
        if (res.ok) return "ok";
        if (res.status === 503) return "waking";
        return "unknown"; // 401/403/etc — not a DB signal, don't nag
    } catch {
        // Timeout / network error: a paused DB stalls the whole request path
        // (auth included), so no-answer-in-time is treated as waking.
        return "waking";
    }
}

export default function DbWakeNotice() {
    const { status } = useSession();
    const [waking, setWaking] = useState(false);

    useEffect(() => {
        if (status !== "authenticated") return;
        let active = true;

        (async () => {
            if ((await probeOnce()) !== "waking" || !active) return;
            setWaking(true);
            // Poll until the DB answers, then hard-reload so anything that
            // failed or stalled mid-wake re-runs against the awake DB.
            while (active) {
                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                if (!active) return;
                if ((await probeOnce()) === "ok") {
                    hardReload.fn();
                    return;
                }
            }
        })();

        return () => {
            active = false;
        };
    }, [status]);

    if (!waking) return null;

    return (
        <Alert color="blue" variant="light" radius={0} title="Waking up the database…">
            <Group align="center" gap="sm" wrap="nowrap">
                <Loader size="sm" color="blue" />
                <Text size="sm">
                    To save cost, the database goes to sleep when nobody has used it for a
                    while. It&apos;s starting back up now — this usually takes about 30
                    seconds, and the page will refresh automatically.
                </Text>
            </Group>
        </Alert>
    );
}
