"use client";

import { useState, useEffect, useCallback } from "react";

interface Participant {
    id: number;
    name: string | null;
    email: string | null;
}
interface ProcessRow {
    id: number;
    kind: string;
    status: string;
    createdAt: string;
    zohoEnvelopeId: string | null;
    contractSignedAt: string | null;
    bgConsentAt: string | null;
    membership: {
        householdId: number;
        isVolunteer: boolean;
        household: { name: string | null; participants: Participant[]; leads: { participantId: number }[] } | null;
    } | null;
}

const STATUS_COLORS: Record<string, string> = {
    INTAKE: "#94a3b8",
    PENDING_EXTERNAL_ACTION: "#3b82f6",
    PENDING_BG_REVIEW: "#a855f7",
    PENDING_PAYMENT: "#f59e0b",
    BLOCKED: "#ef4444",
    PENDING_RENEWAL: "#14b8a6",
    RENEWAL_PENDING_BG: "#a855f7",
};

export default function AdminMembershipPage() {
    const [rows, setRows] = useState<ProcessRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/admin/membership");
            if (res.ok) {
                const data = await res.json();
                setRows(data.processes || []);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const act = async (processId: number, action: string, extra?: Record<string, unknown>) => {
        setBusyId(processId);
        setMessage("");
        try {
            const res = await fetch("/api/admin/membership/external", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ processId, action, ...extra }),
            });
            const data = await res.json();
            if (res.ok) {
                setIsError(false);
                setMessage("Updated.");
                await load();
            } else {
                setIsError(true);
                setMessage(data.error || "Action failed.");
            }
        } catch {
            setIsError(true);
            setMessage("Network error.");
        } finally {
            setBusyId(null);
        }
    };

    const householdLabel = (r: ProcessRow) => {
        const hh = r.membership?.household;
        if (!hh) return `Household #${r.membership?.householdId ?? "?"}`;
        // Parents are the household leads.
        const leadIds = new Set((hh.leads || []).map((l) => l.participantId));
        const parents = (hh.participants || []).filter((p) => leadIds.has(p.id)).map((p) => p.name || p.email).filter(Boolean);
        return hh.name || parents.join(" & ") || `Household #${r.membership?.householdId}`;
    };

    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <div className="glass-container animate-float" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
                <h1 className="text-gradient" style={{ marginTop: 0 }}>Membership Applications</h1>
                <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
                    In-flight applications. Use the manual controls below to confirm the contract was signed or that
                    background-check consent was received. (The contract is also confirmed automatically once the Zoho
                    webhook is configured.)
                </p>
            </div>

            {message && (
                <div style={{ marginBottom: "1rem", padding: "0.85rem 1rem", borderRadius: "8px", background: isError ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`, color: isError ? "#f87171" : "#4ade80" }}>
                    {message}
                </div>
            )}

            {loading ? (
                <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
            ) : rows.length === 0 ? (
                <div className="glass-container" style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-muted)" }}>
                    No in-flight membership applications.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {rows.map((r) => (
                        <div key={r.id} className="glass-container" style={{ padding: "1.25rem 1.5rem" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}>
                                <div>
                                    <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{householdLabel(r)}</div>
                                    <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                                        {r.kind} · application #{r.id}
                                        {r.membership?.isVolunteer && <span style={{ marginLeft: 8, color: "#4ade80" }}>· volunteer</span>}
                                    </div>
                                </div>
                                <span style={{ background: STATUS_COLORS[r.status] || "#64748b", color: "#0f172a", padding: "3px 10px", borderRadius: "999px", fontSize: "0.75rem", fontWeight: 700 }}>
                                    {r.status.replace(/_/g, " ")}
                                </span>
                            </div>

                            {r.status === "PENDING_EXTERNAL_ACTION" && (
                                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "1rem" }}>
                                    <div>
                                        <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>Contract</div>
                                        {r.contractSignedAt ? (
                                            <span style={{ color: "#4ade80", fontWeight: 600 }}>✓ Signed</span>
                                        ) : (
                                            <button className="glass-button" disabled={busyId === r.id} onClick={() => act(r.id, "mark-contract")} style={{ padding: "0.45rem 0.9rem", background: "rgba(59,130,246,0.25)", borderColor: "rgba(59,130,246,0.5)" }}>
                                                {busyId === r.id ? "…" : "Confirm contract signed"}
                                            </button>
                                        )}
                                    </div>
                                    <div>
                                        <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginBottom: "0.35rem" }}>Background-check consent</div>
                                        {r.bgConsentAt ? (
                                            <span style={{ color: "#4ade80", fontWeight: 600 }}>✓ Received</span>
                                        ) : (
                                            <button className="glass-button" disabled={busyId === r.id} onClick={() => act(r.id, "mark-bg-consent")} style={{ padding: "0.45rem 0.9rem" }}>
                                                {busyId === r.id ? "…" : "Confirm BG consent"}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
