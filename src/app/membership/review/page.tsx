"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

interface Participant {
    id: number;
    name: string | null;
    email: string | null;
}
// Shape returned by GET /api/membership/reviews (security-stripped model rows).
// Only the household leads (parents) are returned — children are never sent.
interface QueueItem {
    id: number;
    membership: { household: { name: string | null; leads: { participant: Participant }[] } | null } | null;
    _count: { attestations: number };
}

export default function MembershipReviewPage() {
    const { status: sessionStatus } = useSession();
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [forbidden, setForbidden] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);
    const [volunteer, setVolunteer] = useState<Record<number, boolean>>({});
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/membership/reviews");
            if (res.status === 403) {
                setForbidden(true);
                return;
            }
            if (res.ok) {
                const data = await res.json();
                setQueue(data.queue || []);
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (sessionStatus === "authenticated") load();
        else if (sessionStatus === "unauthenticated") setLoading(false);
    }, [sessionStatus, load]);

    const submit = async (processId: number, result: "APPROVE" | "REJECT") => {
        setBusyId(processId);
        setMessage("");
        try {
            const res = await fetch("/api/membership/reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ processId, result, markedVolunteer: !!volunteer[processId] }),
            });
            const data = await res.json();
            if (res.ok) {
                setIsError(false);
                setMessage(result === "APPROVE" ? "Attestation recorded — thank you." : "Recorded. The board has been notified.");
                await load();
            } else {
                setIsError(true);
                setMessage(data.error || "Could not record your attestation.");
            }
        } catch {
            setIsError(true);
            setMessage("Network error.");
        } finally {
            setBusyId(null);
        }
    };

    if (sessionStatus === "loading" || loading) {
        return <main style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-muted)" }}>Loading…</main>;
    }

    if (forbidden || sessionStatus === "unauthenticated") {
        return (
            <main style={{ padding: "2rem", textAlign: "center" }}>
                <div className="glass-container" style={{ maxWidth: "480px", margin: "0 auto", padding: "2rem" }}>
                    <h1>Background-check review</h1>
                    <p style={{ color: "var(--color-text-muted)" }}>This area is for background-check reviewers only.</p>
                    <Link href="/" className="glass-button">Home</Link>
                </div>
            </main>
        );
    }

    return (
        <main style={{ maxWidth: "820px", margin: "0 auto", padding: "2rem 1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
                <h1 className="text-gradient" style={{ margin: 0 }}>Background-check review</h1>
                <Link href="/" className="glass-button" style={{ textDecoration: "none", color: "white" }}>&larr; Home</Link>
            </div>

            <p style={{ color: "var(--color-text-muted)", marginTop: 0 }}>
                Review each applicant&apos;s background check on Averity, then attest below. Two independent reviewers are required.
                If anything is concerning, choose <strong>Reject</strong> — the board is notified and the applicant is not told the reason.
            </p>

            {message && (
                <div style={{ margin: "1rem 0", padding: "0.85rem 1rem", borderRadius: "8px", background: isError ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`, color: isError ? "#f87171" : "#4ade80" }}>
                    {message}
                </div>
            )}

            {queue.length === 0 ? (
                <div className="glass-container" style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-muted)" }}>
                    Nothing awaiting your review right now.
                </div>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    {queue.map((item) => {
                        const parents = (item.membership?.household?.leads ?? []).map((l) => l.participant);
                        return (
                        <div key={item.id} className="glass-container" style={{ padding: "1.25rem 1.5rem" }}>
                            <div style={{ fontWeight: 700, fontSize: "1.05rem" }}>{item.membership?.household?.name || `Household (application #${item.id})`}</div>
                            <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
                                {parents.length > 0
                                    ? parents.map((p) => `${p.name || "—"}${p.email ? ` <${p.email}>` : ""}`).join(", ")
                                    : "No parent contact on file."}
                            </div>
                            <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
                                {item._count.attestations}/2 approvals so far.
                            </div>

                            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.9rem 0", cursor: "pointer" }}>
                                <input
                                    type="checkbox"
                                    checked={!!volunteer[item.id]}
                                    onChange={(e) => setVolunteer((v) => ({ ...v, [item.id]: e.target.checked }))}
                                />
                                <span>This is a volunteer family</span>
                            </label>

                            <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
                                <button className="glass-button" disabled={busyId === item.id} onClick={() => submit(item.id, "APPROVE")} style={{ padding: "0.55rem 1.1rem", background: "rgba(34,197,94,0.2)", borderColor: "rgba(34,197,94,0.4)" }}>
                                    {busyId === item.id ? "…" : "Attest — check is clean"}
                                </button>
                                <button className="glass-button" disabled={busyId === item.id} onClick={() => submit(item.id, "REJECT")} style={{ padding: "0.55rem 1.1rem", background: "rgba(239,68,68,0.18)", borderColor: "rgba(239,68,68,0.45)" }}>
                                    {busyId === item.id ? "…" : "Reject"}
                                </button>
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}
        </main>
    );
}
