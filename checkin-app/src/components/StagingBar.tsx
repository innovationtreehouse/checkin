"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useIsStagingInstance } from "@/components/EnvProvider";

/**
 * Persistent staging-instance bar — the ops-stg counterpart of DevImpersonationBar's
 * dev banner, in amber so the two environments cannot be mistaken for each other.
 * Shown to everyone (staging holds a scrubbed prod copy; even the /signin page
 * should say which instance this is), not just signed-in users.
 */
export default function StagingBar() {
    return (
        <Suspense fallback={null}>
            <StagingBarInner />
        </Suspense>
    );
}

function StagingBarInner() {
    const isStaging = useIsStagingInstance();
    const searchParams = useSearchParams();

    // Same kiosk-strip rule as DevImpersonationBar/AppFrame: kiosk views are full-screen.
    const isKioskMode = searchParams.get("mode") === "kiosk" || !!searchParams.get("sig");
    if (!isStaging || isKioskMode) return null;

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.5rem 1rem",
                background: "rgba(245, 158, 11, 0.15)",
                borderBottom: "1px solid rgba(245, 158, 11, 0.4)",
                fontSize: "0.85rem",
            }}
        >
            <span style={{ fontWeight: 600 }}>
                🚧 Staging instance — scrubbed copy of production data; changes here are discarded on the next reseed
            </span>
        </div>
    );
}
