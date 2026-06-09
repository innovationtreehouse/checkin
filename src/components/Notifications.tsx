"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface NotificationData {
    membership: { pendingReviews: number; blocked: number };
}

/**
 * In-app red-dot indicators, fed by GET /api/notifications. Today it surfaces the
 * membership domain (a reviewer's pending queue, the board's blocked applications);
 * other domains can be added as new sections as the API grows. Renders nothing when
 * there's nothing to show. Polls lightly so the dots stay current without a refresh.
 */
export default function Notifications() {
    const [data, setData] = useState<NotificationData | null>(null);

    useEffect(() => {
        let cancelled = false;
        const fetchCounts = () =>
            fetch("/api/notifications")
                .then((res) => (res.ok ? res.json() : null))
                .then((d) => { if (!cancelled && d) setData(d); })
                .catch(() => { /* silent — indicators are best-effort */ });
        fetchCounts();
        const t = setInterval(fetchCounts, 60000);
        return () => { cancelled = true; clearInterval(t); };
    }, []);

    const m = data?.membership;
    if (!m || (m.pendingReviews === 0 && m.blocked === 0)) return null;

    const badge = (color: string, label: string) => (
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "20px", height: "20px", padding: "0 6px", borderRadius: "999px", background: color, color: "white", fontSize: "0.72rem", fontWeight: 700 }}>
            {label}
        </span>
    );

    const linkStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "0.5rem", textDecoration: "none", color: "white", padding: "0.75rem 1.25rem", borderRadius: "var(--glass-radius, 16px)" };

    return (
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            {m.pendingReviews > 0 && (
                <Link href="/membership/review" className="glass-button" style={{ ...linkStyle, background: "rgba(168,85,247,0.25)", borderColor: "rgba(168,85,247,0.5)" }}>
                    🔍 Background-check reviews {badge("#a855f7", String(m.pendingReviews))}
                </Link>
            )}
            {m.blocked > 0 && (
                <Link href="/admin/membership" className="glass-button" style={{ ...linkStyle, background: "rgba(239,68,68,0.2)", borderColor: "rgba(239,68,68,0.5)" }}>
                    🚨 Blocked applications {badge("#ef4444", String(m.blocked))}
                </Link>
            )}
        </div>
    );
}
