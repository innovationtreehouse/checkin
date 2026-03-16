"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../../../page.module.css";

export default function MergeParticipants() {
    const router = useRouter();
    const [searchA, setSearchA] = useState("");
    const [searchB, setSearchB] = useState("");
    const [resultsA, setResultsA] = useState<any[]>([]);
    const [resultsB, setResultsB] = useState<any[]>([]);

    const [pA, setPA] = useState<any>(null);
    const [pB, setPB] = useState<any>(null);

    const [analyzedA, setAnalyzedA] = useState<any>(null);
    const [analyzedB, setAnalyzedB] = useState<any>(null);

    const [keepId, setKeepId] = useState<number | null>(null);

    const [loading, setLoading] = useState(false);
    const [merging, setMerging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const [previewMode, setPreviewMode] = useState(false);

    useEffect(() => {
        if (searchA.length > 2 && !pA) {
            fetch(`/api/admin/participants/search?q=${encodeURIComponent(searchA)}`)
                .then(r => r.json())
                .then(d => setResultsA(d.participants || []));
        } else {
            setResultsA([]);
        }
    }, [searchA, pA]);

    useEffect(() => {
        if (searchB.length > 2 && !pB) {
            fetch(`/api/admin/participants/search?q=${encodeURIComponent(searchB)}`)
                .then(r => r.json())
                .then(d => setResultsB(d.participants || []));
        } else {
            setResultsB([]);
        }
    }, [searchB, pB]);

    useEffect(() => {
        if (pA && pB) {
            setLoading(true);
            fetch(`/api/admin/participants/merge/analyze?a=${pA.id}&b=${pB.id}`)
                .then(r => r.json())
                .then(d => {
                    if (d.participants) {
                        setAnalyzedA(d.participants[0]);
                        setAnalyzedB(d.participants[1]);

                        // Recommend keeping the one with more activity or better data
                        const score = (p: any) => {
                            let s = 0;
                            s += p._count.visits * 2;
                            s += p._count.rawBadgeEvents;
                            s += p._count.programParticipants * 5;
                            s += p._count.programVolunteers * 5;
                            if (p.email) s += 10;
                            if (p.phone) s += 10;
                            if (p.googleId) s += 20; // real account
                            return s;
                        };
                        const sA = score(d.participants[0]);
                        const sB = score(d.participants[1]);

                        setKeepId(sA >= sB ? pA.id : pB.id);
                    }
                })
                .catch(e => setError("Failed to analyze participants"))
                .finally(() => setLoading(false));
        } else {
            setAnalyzedA(null);
            setAnalyzedB(null);
            setKeepId(null);
            setPreviewMode(false);
        }
    }, [pA, pB]);

    const handleMerge = async () => {
        setMerging(true);
        setError(null);
        try {
            const res = await fetch("/api/admin/participants/merge", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    keepId,
                    mergeId: keepId === pA?.id ? pB?.id : pA?.id
                })
            });
            const data = await res.json();
            if (res.ok) {
                setSuccess(true);
            } else {
                setError(data.error || "Failed to merge");
            }
        } catch (e: any) {
            setError(e.message || "Network error");
        } finally {
            setMerging(false);
        }
    };

    const renderSearch = (label: string, value: string, setValue: (v: string) => void, results: any[], selected: any, setSelected: (p: any) => void) => (
        <div style={{ flex: 1, position: "relative" }}>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>{label}</label>
            {selected ? (
                <div className="glass-container" style={{ padding: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(59, 130, 246, 0.1)" }}>
                    <div>
                        <strong>{selected.name || "Unnamed"}</strong>
                        <div style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>{selected.email || "No email"} | ID: {selected.id}</div>
                    </div>
                    <button onClick={() => setSelected(null)} className="glass-button" style={{ padding: "0.25rem 0.5rem", fontSize: "0.8rem" }}>Change</button>
                </div>
            ) : (
                <>
                    <input
                        className="glass-input"
                        value={value}
                        onChange={e => setValue(e.target.value)}
                        placeholder="Search by name or email..."
                        style={{ width: "100%", padding: "0.75rem" }}
                    />
                    {results.length > 0 && (
                        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10, background: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px", maxHeight: "250px", overflowY: "auto" }}>
                            {results.map(r => (
                                <div key={r.id} onClick={() => setSelected(r)} style={{ padding: "0.75rem", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                                    <div>{r.name || "Unnamed"} <span style={{ color: "gray", fontSize: "0.8rem" }}>(ID: {r.id})</span></div>
                                    <div style={{ fontSize: "0.8rem", color: "gray" }}>{r.email}</div>
                                </div>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );

    const renderStats = (p: any, isKept: boolean, isLeadWithOthers: boolean) => (
        <div className="glass-container" style={{ padding: "1.5rem", border: isKept ? "2px solid #22c55e" : "2px solid #ef4444", background: isKept ? "rgba(34, 197, 94, 0.05)" : "rgba(239, 68, 68, 0.05)" }}>
            <h3 style={{ marginTop: 0, color: isKept ? "#4ade80" : "#f87171" }}>
                {isKept ? "Keep and augment" : "Merge and delete"}
            </h3>

            <div style={{ marginBottom: "1rem" }}>
                <strong>{p.name || "Unnamed"}</strong> (ID: {p.id})
                <div>Email: {p.email || "—"}</div>
                <div>Phone: {p.phone || "—"}</div>
                <div>Google Auth: {p.googleId ? "Yes" : "No"}</div>
            </div>

            <div style={{ fontSize: "0.9rem", color: "var(--color-text-muted)" }}>
                <div>Visits: {p._count.visits}</div>
                <div>Raw Badge Events: {p._count.rawBadgeEvents}</div>
                <div>Program Participation: {p._count.programParticipants}</div>
                <div>Program Volunteering: {p._count.programVolunteers}</div>

                <div style={{ marginTop: "1rem" }}>
                    Household: {p.household ? p.household.name || `Household #${p.household.id}` : "None"}
                    {p.household && (
                        <ul style={{ margin: "0.25rem 0", paddingLeft: "1.2rem" }}>
                            {p.household.participants.map((hp: any) => (
                                <li key={hp.id}>{hp.name} {hp.id === p.id && "(This)"} {p.household.leads.find((l:any) => l.participantId === hp.id) && "[Lead]"}</li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {!isKept && isLeadWithOthers && (
                <div style={{ marginTop: "1rem", color: "#f87171", fontWeight: "bold", background: "rgba(239, 68, 68, 0.2)", padding: "0.5rem", borderRadius: "4px" }}>
                    Error: This participant is the lead of a household with other members. You cannot delete them. Change the household lead first.
                </div>
            )}

            {!isKept && p.household && !isLeadWithOthers && p.household.participants.length > 1 && (
                <div style={{ marginTop: "1rem", color: "#eab308", fontWeight: "bold", background: "rgba(234, 179, 8, 0.2)", padding: "0.5rem", borderRadius: "4px" }}>
                    Warning: This participant is in a household with others. They will be removed from that household during deletion.
                </div>
            )}
        </div>
    );

    if (success) {
        return (
            <div style={{ maxWidth: "1000px", margin: "0 auto", padding: "2rem" }}>
                <div className="glass-container" style={{ padding: "2rem", textAlign: "center", borderColor: "#22c55e" }}>
                    <h2 style={{ color: "#4ade80", margin: "0 0 1rem 0" }}>Merge Successful!</h2>
                    <p>The participants have been successfully merged.</p>
                    <button className="glass-button" onClick={() => {
                        setSuccess(false);
                        setPA(null); setPB(null);
                        setSearchA(""); setSearchB("");
                    }}>Merge More</button>
                    <button className="glass-button" style={{ marginLeft: "1rem" }} onClick={() => router.push('/admin/participants')}>Back to Participants</button>
                </div>
            </div>
        );
    }

    const mergeParticipant = keepId === analyzedA?.id ? analyzedB : analyzedA;
    const keepParticipant = keepId === analyzedA?.id ? analyzedA : analyzedB;

    let isLeadWithOthers = false;
    if (mergeParticipant && !previewMode) {
        const isLead = mergeParticipant.household?.leads.find((l:any) => l.participantId === mergeParticipant.id);
        const othersCount = mergeParticipant.household?.participants.filter((p:any) => p.id !== mergeParticipant.id).length || 0;
        isLeadWithOthers = isLead && othersCount > 0;
    }

    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <div className="glass-container animate-float" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h1 className="text-gradient" style={{ marginTop: 0 }}>Merge Participants</h1>
                <p style={{ color: 'var(--color-text-muted)' }}>
                    Combine two participant records. The data from the merged record (visits, programs, etc) will be moved to the kept record. The merged record will be tombstoned.
                </p>
            </div>

            {error && (
                <div style={{ padding: "1rem", background: "rgba(239, 68, 68, 0.2)", color: "#fca5a5", border: "1px solid #ef4444", borderRadius: "8px", marginBottom: "1rem" }}>
                    {error}
                </div>
            )}

            {!previewMode ? (
                <>
                    <div className="glass-container" style={{ padding: "1.5rem", marginBottom: "2rem", display: "flex", gap: "2rem" }}>
                        {renderSearch("Participant 1", searchA, setSearchA, resultsA, pA, setPA)}
                        {renderSearch("Participant 2", searchB, setSearchB, resultsB, pB, setPB)}
                    </div>

                    {loading && <p>Analyzing participants...</p>}

                    {analyzedA && analyzedB && (
                        <div>
                            <div style={{ display: "flex", justifyContent: "center", marginBottom: "1rem" }}>
                                <button className="glass-button" onClick={() => setKeepId(keepId === analyzedA.id ? analyzedB.id : analyzedA.id)}>
                                    Swap Kept / Merged
                                </button>
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
                                {renderStats(analyzedA, keepId === analyzedA.id, analyzedA.id !== keepId ? isLeadWithOthers : false)}
                                {renderStats(analyzedB, keepId === analyzedB.id, analyzedB.id !== keepId ? isLeadWithOthers : false)}
                            </div>

                            <div style={{ marginTop: "2rem", textAlign: "right" }}>
                                <button
                                    className="glass-button"
                                    style={{ background: "rgba(59, 130, 246, 0.2)", borderColor: "rgba(59, 130, 246, 0.5)", padding: "0.75rem 2rem", fontSize: "1.1rem" }}
                                    disabled={isLeadWithOthers}
                                    onClick={() => setPreviewMode(true)}
                                >
                                    Proceed to Preview
                                </button>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <div className="glass-container" style={{ padding: "2rem", border: "1px solid #eab308" }}>
                    <h2 style={{ marginTop: 0, color: "#facc15" }}>Preview & Confirm Merge</h2>
                    <p><strong>This action is extremely difficult to undo.</strong> Please review the changes below.</p>

                    <ul style={{ fontSize: "1.1rem", lineHeight: "1.8", margin: "2rem 0" }}>
                        <li><strong>{mergeParticipant.name || mergeParticipant.email || `ID ${mergeParticipant.id}`}</strong> will be tombstoned.</li>
                        <li>All visits, program enrollments, RSVPs, and fee payments will be transferred to <strong>{keepParticipant.name || keepParticipant.email || `ID ${keepParticipant.id}`}</strong>.</li>
                        <li>Missing personal info on the kept participant will be filled in from the merged participant.</li>
                        <li>Raw badge scans will remain on the tombstoned record for audit purposes.</li>
                    </ul>

                    <div style={{ display: "flex", gap: "1rem", justifyContent: "flex-end" }}>
                        <button className="glass-button" onClick={() => setPreviewMode(false)} disabled={merging}>Cancel</button>
                        <button className="glass-button" style={{ background: "rgba(239, 68, 68, 0.2)", borderColor: "rgba(239, 68, 68, 0.5)" }} onClick={handleMerge} disabled={merging}>
                            {merging ? "Merging..." : "Confirm Merge & Delete"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
