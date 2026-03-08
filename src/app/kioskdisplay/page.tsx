"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import styles from "../page.module.css";
import { formatTime } from "@/lib/time";

type Participant = {
    id: number;
    email: string;
    name?: string | null;
    keyholder: boolean;
    sysadmin: boolean;
    dob?: string | null;
    householdId?: number | null;
};

const isMinor = (dob: string | undefined | null) => {
    if (!dob) return false;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    return age < 18;
};

type Visit = {
    id: number;
    arrived: string;
    participant: Participant;
};

export default function KioskDisplay() {
    const { data: session } = useSession();
    const [attendance, setAttendance] = useState<Visit[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [checkingOut, setCheckingOut] = useState<number | null>(null);
    const [household, setHousehold] = useState<any>(null);

    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [searching, setSearching] = useState(false);
    const [checkingInId, setCheckingInId] = useState<number | null>(null);

    const currentUserIsSysadmin = (session?.user as any)?.sysadmin || false;
    const currentUserIsKeyholder = (session?.user as any)?.keyholder || false;
    const currentUserIsBoardMember = (session?.user as any)?.boardMember || false;
    const currentUserHouseholdId = (session?.user as any)?.householdId || null;
    const canManuallyCheckInGlobal = currentUserIsSysadmin || currentUserIsKeyholder || currentUserIsBoardMember;
    const canCheckInHousehold = Boolean(currentUserHouseholdId);


    const fetchHousehold = async () => {
        if (!currentUserHouseholdId) return;
        try {
            const res = await fetch("/api/household");
            if (res.ok) {
                const data = await res.json();
                setHousehold(data.household);
            }
        } catch (error) {
            console.error("Failed to fetch household:", error);
        }
    };

    useEffect(() => {
        if (canCheckInHousehold) {
            fetchHousehold();
        }
    }, [canCheckInHousehold]);

    const fetchAttendance = async () => {
        try {
            const res = await fetch("/api/attendance");
            const data = await res.json();
            if (res.ok && data.attendance) {
                setAttendance(data.attendance);
                setError(null);
            } else if (!res.ok) {
                setError(data.error || "Failed to load attendance");
            }
        } catch (error) {
            console.error("Failed to fetch attendance:", error);
            setError("Network error");
        } finally {
            setLoading(false);
        }
    };

    const handleForceCheckout = async (visitId: number) => {
        if (!confirm("Are you sure you want to force checkout this user?")) return;

        setCheckingOut(visitId);
        try {
            const res = await fetch("/api/attendance", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visitId })
            });
            if (res.ok) {
                // Remove the visit immediately on success
                setAttendance(prev => prev.filter(v => v.id !== visitId));
            } else {
                alert("Failed to force checkout.");
            }
        } catch (e) {
            console.error(e);
            alert("Network error.");
        } finally {
            setCheckingOut(null);
        }
    };

    useEffect(() => {
        fetchAttendance();
        // Refresh every 10 seconds
        const interval = setInterval(fetchAttendance, 10000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        const performSearch = async () => {
            if (searchQuery.length < 2) {
                setSearchResults([]);
                return;
            }
            setSearching(true);
            try {
                // Borrow admin roles endpoint which conveniently searches participants
                const res = await fetch(`/api/admin/roles`);
                if (res.ok) {
                    const data = await res.json();
                    const filtered = data.participants.filter((p: any) =>
                        p.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        p.email.toLowerCase().includes(searchQuery.toLowerCase())
                    );
                    setSearchResults(filtered);
                }
            } catch (error) {
                console.error("Search error:", error);
            } finally {
                setSearching(false);
            }
        };

        const timeoutId = setTimeout(performSearch, 300);
        return () => clearTimeout(timeoutId);
    }, [searchQuery]);

    const handleManualCheckIn = async (participantId: number) => {
        setCheckingInId(participantId);
        try {
            const res = await fetch("/api/attendance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "MANUAL_CHECKIN", participantId })
            });

            if (res.ok) {
                setSearchQuery("");
                setSearchResults([]);
                fetchAttendance();
            } else {
                const data = await res.json();
                alert(`Error: ${data.error}`);
            }
        } catch (e) {
            console.error(e);
            alert("Network error.");
        } finally {
            setCheckingInId(null);
        }
    };

    const keyholdersPresent = attendance.filter((v) => v.participant.keyholder).length;

    const activeAdultVisits = attendance.filter((v) => !isMinor(v.participant.dob));
    const activeMinorVisits = attendance.filter((v) => isMinor(v.participant.dob));

    // A minor is 'unaccompanied' if they have no adult from their own household checked in.
    const unaccompaniedMinors = activeMinorVisits.filter(minorVisit => {
        // If they don't belong to a household, they are considered unaccompanied immediately.
        if (!minorVisit.participant.householdId) return true;

        // Otherwise, see if any active adult shares their household ID.
        const hasAdultInHousehold = activeAdultVisits.some(
            adultVisit => adultVisit.participant.householdId === minorVisit.participant.householdId
        );
        return !hasAdultInHousehold;
    });

    const isTwoDeepViolation = unaccompaniedMinors.length > 0 && activeAdultVisits.length < 2;

    const displayResults = searchResults.filter(p => !attendance.some(v => v.participant.id === p.id));

    return (
        <main className={styles.main}>
            <div className="glass-container" style={{ width: "100%", maxWidth: "1200px" }}>
                <div style={{ marginBottom: '2rem' }}>
                    {!attendance.some(v => v.participant.id === (session?.user as any)?.id) ? (
                        <button
                            onClick={() => handleManualCheckIn((session?.user as any)?.id)}
                            disabled={checkingInId === (session?.user as any)?.id}
                            className="glass-button primary"
                            style={{ padding: '1rem 2rem', fontSize: '1.1rem', fontWeight: 600, width: '100%' }}
                        >
                            {checkingInId === (session?.user as any)?.id ? 'Checking In...' : 'Check Me In'}
                        </button>
                    ) : (
                        <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: '8px', color: '#6ee7b7', textAlign: 'center' }}>
                            You are currently checked in!
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0 }}>Current Attendance</h1>
                    <div style={{ padding: '0.5rem 1rem', background: 'rgba(255,255,255,0.1)', borderRadius: '20px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                        <span title={`${activeMinorVisits.length} Minors Present`}>{attendance.length} People Present</span>
                    </div>
                </div>

                {canCheckInHousehold && household && household.leads?.some((l:any) => l.participantId === (session?.user as any)?.id) && (
                    <div style={{ marginBottom: '2rem' }}>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--color-primary-light)' }}>Check In Household Members</h3>
                        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            {household.participants?.filter((p:any) => !attendance.some(v => v.participant.id === p.id)).map((p:any) => (
                                <button
                                    key={p.id}
                                    onClick={() => handleManualCheckIn(p.id)}
                                    disabled={checkingInId === p.id}
                                    className="glass-button"
                                    style={{ padding: '0.5rem 1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                >
                                    {checkingInId === p.id ? '...' : <span>{p.name || p.email}</span>}
                                </button>
                            ))}
                            {household.participants?.filter((p:any) => !attendance.some(v => v.participant.id === p.id)).length === 0 && (
                                <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic', fontSize: '0.875rem' }}>All household members are currently checked in!</span>
                            )}
                        </div>
                    </div>
                )}

                {canManuallyCheckInGlobal && (
                    <div style={{ marginBottom: '2rem', position: 'relative' }}>
                        <input
                            type="text"
                            placeholder="Manually check someone in (Search by name or email)..."
                            className="glass-input"
                            style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {displayResults.length > 0 && searchQuery.length >= 2 && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, right: 0,
                                background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px', marginTop: '4px', zIndex: 10,
                                maxHeight: '200px', overflowY: 'auto'
                            }}>
                                {displayResults.map(p => (
                                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <div>
                                            <div style={{ fontWeight: 500 }}>{p.name || 'Unnamed'}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{p.email}</div>
                                        </div>
                                        <button
                                            disabled={checkingInId === p.id}
                                            onClick={() => handleManualCheckIn(p.id)}
                                            style={{
                                                background: 'rgba(59, 130, 246, 0.2)', color: '#93c5fd',
                                                border: '1px solid rgba(59, 130, 246, 0.4)', borderRadius: '4px',
                                                padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.8rem'
                                            }}
                                        >
                                            {checkingInId === p.id ? '...' : 'Check In'}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {isTwoDeepViolation ? (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.2)',
                        border: '1px solid rgba(239, 68, 68, 0.5)',
                        color: '#fca5a5',
                        padding: '1rem',
                        borderRadius: '8px',
                        marginBottom: '1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <span>🚨</span>
                        <strong>Critical Warning:</strong> Two-Deep Compliance is failing! An unaccompanied minor is present, but there are only {activeAdultVisits.length} adult(s) in the building.
                    </div>
                ) : keyholdersPresent === 1 && (
                    <div style={{
                        background: 'rgba(245, 158, 11, 0.2)',
                        border: '1px solid rgba(245, 158, 11, 0.5)',
                        color: '#fcd34d',
                        padding: '1rem',
                        borderRadius: '8px',
                        marginBottom: '1.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <span>⚠️</span>
                        <strong>Warning:</strong> Only one keyholder is currently in the building.
                    </div>
                )}

                {loading ? (
                    <p style={{ color: "var(--color-text-muted)" }}>Loading attendance...</p>
                ) : error ? (
                    <div style={{ textAlign: "center", padding: "3rem", color: "#fca5a5", background: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                        <p>{error === "Unauthorized" ? "Access Denied: Please sign in to view attendance." : error}</p>
                    </div>
                ) : attendance.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-muted)" }}>
                        <p>The facility is currently empty.</p>
                    </div>
                ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.5rem" }}>
                        {attendance.map((visit) => (
                            <li
                                key={visit.id}
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "0.5rem 0.75rem",
                                    background: "rgba(255, 255, 255, 0.05)",
                                    borderRadius: "6px",
                                    border: "1px solid rgba(255, 255, 255, 0.05)",
                                }}
                            >
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", overflow: "hidden" }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                        <span style={{ fontWeight: 500, fontSize: "0.85rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={visit.participant.name || visit.participant.email}>
                                            {visit.participant.name || visit.participant.email.split('@')[0]}
                                        </span>
                                        {visit.participant.keyholder && (
                                            <span style={{ fontSize: "0.65rem", background: "rgba(59, 130, 246, 0.2)", color: "#93c5fd", padding: "2px 4px", borderRadius: "4px", flexShrink: 0 }}>
                                                Key
                                            </span>
                                        )}
                                        {isMinor(visit.participant.dob) && (
                                            <span style={{ fontSize: "0.65rem", background: "rgba(168, 85, 247, 0.2)", color: "#c084fc", padding: "2px 4px", borderRadius: "4px", flexShrink: 0 }}>
                                                Minor
                                            </span>
                                        )}
                                    </div>
                                    <div style={{ color: "var(--color-text-muted)", fontSize: "0.75rem" }}>
                                        {formatTime(visit.arrived)}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', marginLeft: '0.5rem' }}>
                                    {(currentUserIsSysadmin || currentUserIsKeyholder || currentUserIsBoardMember || visit.participant.id === (session?.user as any)?.id || (household?.leads?.some((l:any) => l.participantId === (session?.user as any)?.id) && visit.participant.householdId === currentUserHouseholdId)) && (
                                        <button
                                            onClick={() => handleForceCheckout(visit.id)}
                                            disabled={checkingOut === visit.id}
                                            style={{
                                                background: 'rgba(239, 68, 68, 0.2)',
                                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                                color: '#fca5a5',
                                                padding: '0.2rem 0.5rem',
                                                borderRadius: '4px',
                                                cursor: 'pointer',
                                                fontSize: '0.75rem',
                                                whiteSpace: 'nowrap'
                                            }}
                                        >
                                            {checkingOut === visit.id ? "..." : "Out"}
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </main >
    );
}
