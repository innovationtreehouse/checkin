"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

type ParticipantInfo = {
    id: number;
    name: string | null;
    isPresent: boolean;
};

type LeadInfo = {
    id: number;
    name: string | null;
    phone: string | null;
    email: string | null;
};

type Household = {
    id: number;
    name: string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    isPresent: boolean;
    participants: ParticipantInfo[];
    leads: LeadInfo[];
};

export default function EmergencyContactsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [households, setHouseholds] = useState<Household[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [error, setError] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            const user = session?.user as {sysadmin?: boolean; boardMember?: boolean; keyholder?: boolean};
            const isAuthorized = user?.sysadmin || user?.boardMember || user?.keyholder;
            if (!isAuthorized) {
                router.push('/');
            } else {
                fetchContacts();
            }
        }
    }, [status, session, router]);

    const fetchContacts = async () => {
        try {
            const res = await fetch('/api/admin/emergency-contacts');
            if (res.ok) {
                const data = await res.json();
                
                // Sort so that households with physically present participants float to the top
                const sorted = (data.households || []).sort((a: Household, b: Household) => {
                    if (a.isPresent && !b.isPresent) return -1;
                    if (!a.isPresent && b.isPresent) return 1;
                    return (a.name || "").localeCompare(b.name || "");
                });

                setHouseholds(sorted);
            } else {
                setError("Failed to load emergency contacts. Ensure you have the proper authorizations.");
            }
        } catch (e) {
            console.error(e);
            setError("Network error loading contacts.");
        } finally {
            setLoading(false);
        }
    };

    // Derived state for searching
    const filteredHouseholds = households.filter((h) => {
        const query = searchQuery.toLowerCase();
        
        // Match household name
        if (h.name && h.name.toLowerCase().includes(query)) return true;
        
        // Match parent/lead names
        if (h.leads.some(l => l.name && l.name.toLowerCase().includes(query))) return true;

        // Match participant/child names
        if (h.participants.some(p => p.name && p.name.toLowerCase().includes(query))) return true;

        return false;
    });

    if (loading || status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float" style={{ textAlign: "center", padding: "3rem" }}>
                    <h2>Loading Emergency Contacts…</h2>
                </div>
            </main>
        );
    }

    if (error) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float" style={{ textAlign: "center", padding: "3rem" }}>
                    <h2 style={{ color: '#ef4444' }}>{error}</h2>
                    <button className="glass-button" onClick={() => router.push('/admin')}>Back to Admin</button>
                </div>
            </main>
        );
    }

    return (
        <div style={{ maxWidth: "1200px", margin: "0 auto", paddingBottom: "2rem" }}>
            <div className="glass-container" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
                <h1 className="text-gradient" style={{ margin: 0, fontSize: "2rem" }}>
                    🚑 Emergency Contacts
                </h1>
                <p style={{ color: "var(--color-text-muted)", margin: "0.5rem 0 0" }}>
                    Directory of primary guardians and emergency contacts across all active accounts. Households with members physically present are pinned to the top.
                </p>
                
                <input
                    type="text"
                    className="glass-input"
                    placeholder="Search by Household Name, Parent Name, or Member Name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ width: "100%", marginTop: "1.5rem", padding: "1rem", fontSize: "1.1rem" }}
                />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {filteredHouseholds.map(h => (
                    <div key={h.id} className="glass-container" style={{ 
                        padding: "1.5rem", 
                        border: h.isPresent ? "1px solid rgba(56, 189, 248, 0.4)" : undefined,
                        background: h.isPresent ? "rgba(56, 189, 248, 0.05)" : undefined,
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
                        gap: "1.5rem"
                    }}>
                        
                        {/* Household & Participants Block */}
                        <div>
                            <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.3rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                {h.name || `Household #${h.id}`}
                                {h.isPresent && (
                                    <span style={{ fontSize: "0.75rem", background: "rgba(56, 189, 248, 0.2)", color: "#38bdf8", padding: "0.2rem 0.5rem", borderRadius: "4px" }}>
                                        Present Now
                                    </span>
                                )}
                            </h2>
                            <div style={{ fontSize: "0.9rem", color: "var(--color-text-muted)" }}>Members:</div>
                            <ul style={{ margin: "0.25rem 0 0 0", paddingLeft: "1.2rem", color: "#e2e8f0" }}>
                                {h.participants.length > 0 ? h.participants.map(p => (
                                    <li key={p.id}>
                                        {p.name || `Member #${p.id}`}
                                        {p.isPresent && <span style={{ color: "#4ade80", marginLeft: "0.5rem", fontSize: "0.85rem" }}>● (Checked In)</span>}
                                    </li>
                                )) : (
                                    <li style={{ color: "var(--color-text-muted)", fontStyle: "italic" }}>No enrolled members</li>
                                )}
                            </ul>
                        </div>

                        {/* Leads / Parents Block */}
                        <div>
                            <div style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>Household Leads:</div>
                            {h.leads.length > 0 ? h.leads.map(l => (
                                <div key={l.id} style={{ marginBottom: "0.5rem", background: "rgba(0,0,0,0.2)", padding: "0.75rem", borderRadius: "8px" }}>
                                    <div style={{ fontWeight: 500, color: "white" }}>{l.name || l.email}</div>
                                    <div style={{ color: "#94a3b8", fontSize: "0.9rem" }}>Phone: {l.phone || "Not Provided"}</div>
                                </div>
                            )) : (
                                <div style={{ background: "rgba(0,0,0,0.2)", padding: "0.5rem", borderRadius: "8px", color: "#f87171", fontSize: "0.9rem" }}>
                                    No designated leads found.
                                </div>
                            )}
                        </div>

                        {/* Emergency Contact Block */}
                        <div>
                            <div style={{ fontSize: "0.9rem", color: "var(--color-text-muted)", marginBottom: "0.25rem" }}>External Emergency Contact:</div>
                            <div style={{ background: "rgba(239, 68, 68, 0.1)", border: "1px solid rgba(239, 68, 68, 0.2)", padding: "1rem", borderRadius: "8px" }}>
                                {h.emergencyContactName ? (
                                    <>
                                        <div style={{ fontWeight: 600, color: "#fca5a5" }}>{h.emergencyContactName}</div>
                                        <div style={{ color: "#cbd5e1", marginTop: "0.25rem" }}>Phone: {h.emergencyContactPhone || "Not Provided"}</div>
                                    </>
                                ) : (
                                    <div style={{ color: "#f87171", fontStyle: "italic", fontSize: "0.9rem" }}>Not Configured</div>
                                )}
                            </div>
                        </div>

                    </div>
                ))}

                {filteredHouseholds.length === 0 && !loading && (
                    <div className="glass-container" style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-muted)" }}>
                        No households found matching your search.
                    </div>
                )}
            </div>
        </div>
    );
}
