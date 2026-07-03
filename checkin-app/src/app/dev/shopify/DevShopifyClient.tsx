"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PendingProcess {
    id: number;
    household: string;
    isVolunteer: boolean;
}

/**
 * Dev Shopify orders/paid mock UI. Picks a PENDING_PAYMENT process and fires a
 * synthesized-but-real orders/paid webhook at it (via /api/dev/shopify/orders-paid),
 * driving PENDING_PAYMENT → ACTIVE (or → PENDING_BG_CLEARANCE) the same way a real
 * Shopify payment would. Inline styles match the sibling dev tools (dev/zoho-sign).
 * Page 404s off a dev instance.
 */
export default function DevShopifyClient({ hasVariant, processes }: { hasVariant: boolean; processes: PendingProcess[] }) {
    const router = useRouter();
    const [busy, setBusy] = useState<number | null>(null);
    const [result, setResult] = useState<{ id: number; status: string | null } | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function fire(processId: number) {
        setBusy(processId);
        setError(null);
        setResult(null);
        try {
            const res = await fetch("/api/dev/shopify/orders-paid", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ processId }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                setError(data.error ? `${data.error} (${res.status})` : `Webhook failed (${res.status}). Check server logs.`);
                return;
            }
            setResult({ id: processId, status: data.status ?? null });
            // The fired process is no longer PENDING_PAYMENT — refresh the
            // server-rendered list so its row (and 404-on-re-click) disappears.
            router.refresh();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(null);
        }
    }

    const btn: React.CSSProperties = {
        padding: "0.4rem 0.9rem",
        borderRadius: 6,
        border: "none",
        background: "#059669",
        color: "#fff",
        fontWeight: 600,
        cursor: "pointer",
    };

    return (
        <div style={{ maxWidth: 640 }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 600, margin: 0 }}>Shopify orders/paid (mock)</h1>
            <p style={{ opacity: 0.7, fontSize: "0.85rem", marginTop: "0.5rem" }}>
                Shopify is mocked on this instance (no store credentials). Firing a payment sends a
                real signed <code>orders/paid</code> webhook — <strong>DEV, NO REAL MONEY</strong>.
            </p>

            {!hasVariant && (
                <p style={{ color: "#b45309", marginTop: "1rem", fontSize: "0.85rem" }}>
                    No membership variant configured. Set one in <strong>Settings → Membership</strong> first —
                    the mock only needs <em>a</em> value here (any string): it signs a payload carrying that id and
                    the inbound webhook matches it against this same setting, so it&apos;s a closed loop.
                    On a real dev store, set this to the store&apos;s actual variant id instead. Without it the
                    webhook lands as a no-membership-item anomaly instead of activating.
                </p>
            )}

            {error && <p style={{ color: "#b91c1c", marginTop: "1rem" }}>{error}</p>}
            {result && (
                <p style={{ color: "#059669", marginTop: "1rem" }}>
                    Fired for process {result.id} → status <strong>{result.status ?? "unknown"}</strong>
                </p>
            )}

            <div style={{ marginTop: "1.5rem" }}>
                {processes.length === 0 ? (
                    <p style={{ fontSize: "0.9rem", opacity: 0.7 }}>No applications awaiting payment.</p>
                ) : (
                    <table style={{ borderCollapse: "collapse", width: "100%" }}>
                        <thead>
                            <tr style={{ textAlign: "left", fontSize: "0.8rem", opacity: 0.6 }}>
                                <th style={{ padding: "0.4rem" }}>Process</th>
                                <th style={{ padding: "0.4rem" }}>Household</th>
                                <th style={{ padding: "0.4rem" }}>Tier</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {processes.map((p) => (
                                <tr key={p.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                                    <td style={{ padding: "0.4rem" }}>#{p.id}</td>
                                    <td style={{ padding: "0.4rem" }}>{p.household}</td>
                                    <td style={{ padding: "0.4rem" }}>{p.isVolunteer ? "Volunteer" : "Normal"}</td>
                                    <td style={{ padding: "0.4rem", textAlign: "right" }}>
                                        <button
                                            onClick={() => fire(p.id)}
                                            disabled={busy !== null}
                                            style={{ ...btn, opacity: busy !== null ? 0.5 : 1 }}
                                        >
                                            {busy === p.id ? "Firing…" : "Fire orders/paid"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
