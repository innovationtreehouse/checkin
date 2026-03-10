"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
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
    phone?: string | null;
    household?: {
        emergencyContactName: string | null;
        emergencyContactPhone: string | null;
    } | null;
};

type Visit = {
    id: number;
    arrived: string;
    participant: Participant;
    event?: {
        program?: {
            id: number;
            name: string;
        }
    }
};

type Counts = {
    keyholders: number;
    volunteers: number;
    students: number;
    total: number;
};

type SafetyFlags = {
    isLastKeyholder: boolean;
    isTwoDeepViolation: boolean;
};

type FullResponse = {
    access: "full";
    attendance: Visit[];
    counts: Counts;
    safety: SafetyFlags;
};

type LimitedResponse = {
    access: "limited";
    counts: Counts;
    safety: SafetyFlags;
    self: Visit | null;
    household: Visit[];
};

type AttendanceResponse = FullResponse | LimitedResponse;

const isStudent = (dob: string | undefined | null) => {
    if (!dob) return false;
    const birthDate = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const m = today.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
    return age < 18;
};

type SessionUser = {
    id: number;
    sysadmin?: boolean;
    keyholder?: boolean;
    boardMember?: boolean;
    householdId?: number | null;
};

function KioskDisplayInner() {
    const searchParams = useSearchParams();
    const [isKioskMode, setIsKioskMode] = useState(searchParams.get("mode") === "kiosk");
    const { data: session } = useSession();
    const [data, setData] = useState<AttendanceResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [checkingOut, setCheckingOut] = useState<number | null>(null);
    const [household, setHousehold] = useState<{ leads: { participantId: number }[], participants: Participant[] } | null>(null);
    const [showSignOutModal, setShowSignOutModal] = useState(false);
    const [searchSignOutQuery, setSearchSignOutQuery] = useState("");

    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Participant[]>([]);
    const [checkingInId, setCheckingInId] = useState<number | null>(null);

    const currentUserIsSysadmin = (session?.user as SessionUser)?.sysadmin || false;
    const currentUserIsKeyholder = (session?.user as SessionUser)?.keyholder || false;
    const currentUserIsBoardMember = (session?.user as SessionUser)?.boardMember || false;
    const currentUserHouseholdId = (session?.user as SessionUser)?.householdId || null;
    const canManuallyCheckInGlobal = currentUserIsSysadmin || currentUserIsKeyholder || currentUserIsBoardMember;
    const canAdminCheckout = currentUserIsSysadmin || currentUserIsKeyholder || currentUserIsBoardMember;
    const canCheckInHousehold = Boolean(currentUserHouseholdId);

    const isFull = data?.access === "full";
    const counts = data?.counts || { keyholders: 0, volunteers: 0, students: 0, total: 0 };
    const safety = data?.safety || { isLastKeyholder: false, isTwoDeepViolation: false };

    // For full access, split attendance into columns
    const fullAttendance = isFull ? (data as FullResponse).attendance : [];
    const keyholderList = fullAttendance.filter(v => v.participant.keyholder);
    const volunteerList = fullAttendance.filter(v => !v.participant.keyholder && !isStudent(v.participant.dob));
    const studentList = fullAttendance.filter(v => isStudent(v.participant.dob));

    // For limited access, determine visible household members per category
    const limitedHousehold = !isFull && data ? (data as LimitedResponse).household : [];
    const limitedSelf = !isFull && data ? (data as LimitedResponse).self : null;
    const householdKeyholders = limitedHousehold.filter(v => v.participant.keyholder);
    const householdVolunteers = limitedHousehold.filter(v => !v.participant.keyholder && !isStudent(v.participant.dob));
    const householdStudents = limitedHousehold.filter(v => isStudent(v.participant.dob));

    // Is current user checked in?
    const isCheckedIn = isFull
        ? fullAttendance.some(v => v.participant.id === (session?.user as SessionUser)?.id)
        : limitedSelf !== null;

    useEffect(() => {
        const fetchHousehold = async () => {
            if (!currentUserHouseholdId) return;
            try {
                const res = await fetch("/api/household");
                if (res.ok) {
                    const hData = await res.json();
                    setHousehold(hData.household);
                }
            } catch (error) {
                console.error("Failed to fetch household:", error);
            }
        };

        if (canCheckInHousehold) {
            fetchHousehold();
        }
    }, [canCheckInHousehold, currentUserHouseholdId]);

    useEffect(() => {
        const fetchAttendance = async () => {
            try {
                // Check if we are passing signature headers to the API
                const headers: Record<string, string> = {};
                const sigParamsUrl = searchParams.get("sig");
                const tsParamsUrl = searchParams.get("ts");
                const nonceParamsUrl = searchParams.get("nonce");

                if (sigParamsUrl && tsParamsUrl && nonceParamsUrl) {
                    headers["x-kiosk-signature"] = sigParamsUrl;
                    headers["x-kiosk-timestamp"] = tsParamsUrl;
                    headers["x-kiosk-nonce"] = nonceParamsUrl;
                }

                const res = await fetch("/api/attendance", { headers });
                const json = await res.json();
                
                if (res.ok && (json.access === "full" || json.access === "limited")) {
                    setData(json);
                    setError(null);
                    
                    // If it was a signed request, automatically turn on Kiosk Mode
                    if (json.signedRequest === true) {
                        setIsKioskMode(true);
                    }
                } else if (!res.ok) {
                    setError(json.error || "Failed to load attendance");
                }
            } catch (error) {
                console.error("Failed to fetch attendance:", error);
                setError("Network error");
            } finally {
                setLoading(false);
            }
        };

        fetchAttendance();
        const interval = setInterval(fetchAttendance, 60000);

        // Listen for instant refresh from parent wrapper (triggered by badge SSE events)
        const handleMessage = (event: MessageEvent) => {
            if (typeof event.data === "object" && event.data?.type === "refresh-attendance" && event.data.attendance) {
                // Inline attendance data from signed scan response — update directly, no re-fetch needed
                setData({ access: "full", attendance: event.data.attendance, counts: event.data.counts, safety: event.data.safety });
                setLoading(false);
            } else if (event.data === "refresh-attendance") {
                // Fallback: no inline data, re-fetch from server
                fetchAttendance();
            }
        };
        window.addEventListener("message", handleMessage);

        return () => {
            clearInterval(interval);
            window.removeEventListener("message", handleMessage);
        };
    }, [searchParams]);

    useEffect(() => {
        const performSearch = async () => {
            if (searchQuery.length < 2) {
                setSearchResults([]);
                return;
            }
            try {
                const res = await fetch(`/api/admin/roles`);
                if (res.ok) {
                    const data = await res.json();
                    const filtered = data.participants.filter(
                        (p: Participant) =>
                            (p.name || "").toLowerCase().includes((searchQuery || "").toLowerCase()) ||
                            (p.email || "").toLowerCase().includes((searchQuery || "").toLowerCase())
                    );
                    setSearchResults(filtered);
                }
            } catch (error) {
                console.error("Search error:", error);
            }
        };
        const timeoutId = setTimeout(performSearch, 300);
        return () => clearTimeout(timeoutId);
    }, [searchQuery]);

    const handleForceCheckout = async (visitId: number) => {
        if (!confirm("Are you sure you want to force checkout this user?")) return;
        setCheckingOut(visitId);
        try {
            const res = await fetch("/api/attendance", {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ visitId }),
            });
            if (res.ok) {
                // Manually trigger a refresh logic or wait for the interval by changing internal state
                const fetchAttendance = async () => {
                    // Check if we are passing signature headers to the API
                    const headers: Record<string, string> = {};
                    const sigParamsUrl = searchParams.get("sig");
                    const tsParamsUrl = searchParams.get("ts");
                    const nonceParamsUrl = searchParams.get("nonce");

                    if (sigParamsUrl && tsParamsUrl && nonceParamsUrl) {
                        headers["x-kiosk-signature"] = sigParamsUrl;
                        headers["x-kiosk-timestamp"] = tsParamsUrl;
                        headers["x-kiosk-nonce"] = nonceParamsUrl;
                    }

                    const attRes = await fetch("/api/attendance", { headers });
                    const json = await attRes.json();
                    if (attRes.ok && (json.access === "full" || json.access === "limited")) {
                        setData(json);
                    }
                };
                fetchAttendance();
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

    const handleManualCheckIn = async (participantId: number) => {
        setCheckingInId(participantId);
        try {
            const res = await fetch("/api/attendance", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ type: "MANUAL_CHECKIN", participantId }),
            });
            if (res.ok) {
                setSearchQuery("");
                setSearchResults([]);
                // Manually trigger a refresh logic or wait for the interval by changing internal state
                const fetchAttendance = async () => {
                    // Check if we are passing signature headers to the API
                    const headers: Record<string, string> = {};
                    const sigParamsUrl = searchParams.get("sig");
                    const tsParamsUrl = searchParams.get("ts");
                    const nonceParamsUrl = searchParams.get("nonce");

                    if (sigParamsUrl && tsParamsUrl && nonceParamsUrl) {
                        headers["x-kiosk-signature"] = sigParamsUrl;
                        headers["x-kiosk-timestamp"] = tsParamsUrl;
                        headers["x-kiosk-nonce"] = nonceParamsUrl;
                    }

                    const attRes = await fetch("/api/attendance", { headers });
                    const json = await attRes.json();
                    if (attRes.ok && (json.access === "full" || json.access === "limited")) {
                        setData(json);
                    }
                };
                fetchAttendance();
            } else {
                const d = await res.json();
                alert(`Error: ${d.error}`);
            }
        } catch (e) {
            console.error(e);
            alert("Network error.");
        } finally {
            setCheckingInId(null);
        }
    };

    // Visits that are already checked in (for filtering manual search results)
    const checkedInIds = isFull
        ? fullAttendance.map(v => v.participant.id)
        : [...limitedHousehold.map(v => v.participant.id), ...(limitedSelf ? [limitedSelf.participant.id] : [])];
    const displayResults = searchResults.filter(p => !checkedInIds.includes(p.id));

    // -- Render helpers --

    const renderPersonCard = (visit: Visit, showCheckout: boolean) => (
        <div
            key={visit.id}
            style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.5rem 0.75rem",
                background: "rgba(255, 255, 255, 0.04)",
                borderRadius: "6px",
                border: "1px solid rgba(255, 255, 255, 0.06)",
            }}
        >
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                <span
                    style={{
                        fontWeight: 500,
                        fontSize: "0.85rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                    }}
                    title={visit.participant.name || visit.participant.email}
                >
                    {visit.participant.name || visit.participant.email.split("@")[0]}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ color: "var(--color-text-muted)", fontSize: "0.7rem" }}>
                        {formatTime(visit.arrived)}
                    </span>
                    {visit.event?.program?.name && (
                        <span style={{
                            fontSize: "0.6rem",
                            padding: "0.1rem 0.3rem",
                            borderRadius: "4px",
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            overflow: "hidden",
                            maxWidth: "100px",
                            // Generate a consistent hue based on the program name
                            background: `hsl(${visit.event.program.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360}, 60%, 20%)`,
                            color: `hsl(${visit.event.program.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360}, 80%, 80%)`,
                            border: `1px solid hsl(${visit.event.program.name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % 360}, 60%, 30%)`
                        }} title={visit.event.program.name}>
                            {visit.event.program.name}
                        </span>
                    )}
                </div>
                {!isKioskMode && (currentUserIsKeyholder || currentUserIsSysadmin) && (
                    <div style={{ marginTop: "4px", fontSize: "0.7rem", color: "var(--color-primary-light)" }}>
                        {visit.participant.phone && <div>📞 {visit.participant.phone}</div>}
                        {visit.participant.household?.emergencyContactPhone && (
                            <div style={{ color: "#fcd34d", marginTop: "2px" }}>
                                🚨 {visit.participant.household.emergencyContactName?.split(' ')[0]}: {visit.participant.household.emergencyContactPhone}
                            </div>
                        )}
                    </div>
                )}
            </div>
            {showCheckout && (
                <button
                    onClick={() => handleForceCheckout(visit.id)}
                    disabled={checkingOut === visit.id}
                    style={{
                        background: "rgba(239, 68, 68, 0.2)",
                        border: "1px solid rgba(239, 68, 68, 0.4)",
                        color: "#fca5a5",
                        padding: "0.15rem 0.4rem",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.7rem",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                    }}
                >
                    {checkingOut === visit.id ? "..." : "Out"}
                </button>
            )}
        </div>
    );

    const canCheckoutVisit = (visit: Visit): boolean => {
        return Boolean(
            visit.participant.id === (session?.user as SessionUser)?.id ||
            (household?.leads?.some((l: { participantId: number }) => l.participantId === (session?.user as SessionUser)?.id) &&
                visit.participant.householdId === currentUserHouseholdId)
        );
    };

    const columnHeaderStyle = (color: string) => ({
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "0.75rem",
        paddingBottom: "0.5rem",
        borderBottom: `2px solid ${color}`,
    });

    const columnCountStyle = {
        fontSize: "1.5rem",
        fontWeight: 800 as const,
        lineHeight: 1,
    };

    const columnLabelStyle = {
        fontSize: "0.75rem",
        textTransform: "uppercase" as const,
        letterSpacing: "0.05em",
        color: "var(--color-text-muted)",
    };

    return (
        <main className={styles.main} style={isKioskMode ? { cursor: "none" } : undefined}>
            <div className="glass-container" style={{ width: "100%", maxWidth: "1200px" }}>
                {/* Check-in button — hidden in kiosk mode */}
                {!isKioskMode && (
                    <div style={{ marginBottom: "2rem" }}>
                        {!isCheckedIn ? (
                            <button
                                onClick={() => {
                                    const userId = (session?.user as SessionUser)?.id;
                                    if (userId) handleManualCheckIn(userId);
                                }}
                                disabled={checkingInId === (session?.user as SessionUser)?.id}
                                className="glass-button primary"
                                style={{ padding: "1rem 2rem", fontSize: "1.1rem", fontWeight: 600, width: "100%" }}
                            >
                                {checkingInId === (session?.user as SessionUser)?.id ? "Checking In..." : "Check Me In"}
                            </button>
                        ) : (
                            <div
                                style={{
                                    padding: "1rem",
                                    background: "rgba(16, 185, 129, 0.1)",
                                    border: "1px solid rgba(16, 185, 129, 0.3)",
                                    borderRadius: "8px",
                                    color: "#6ee7b7",
                                    textAlign: "center",
                                }}
                            >
                                You are currently checked in!
                            </div>
                        )}
                    </div>
                )}

                {/* Header */}
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "1.5rem",
                        flexWrap: "wrap",
                        gap: "0.5rem",
                    }}
                >
                    <h1 className="text-gradient" style={{ margin: 0 }}>
                        Current Attendance
                    </h1>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
                        {!isKioskMode && canAdminCheckout && (
                            <button
                                onClick={() => setShowSignOutModal(true)}
                                style={{
                                    background: "rgba(239, 68, 68, 0.2)",
                                    border: "1px solid rgba(239, 68, 68, 0.4)",
                                    color: "#fca5a5",
                                    padding: "0.5rem 1rem",
                                    borderRadius: "20px",
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    fontSize: "0.85rem",
                                }}
                            >
                                Sign out a user
                            </button>
                        )}
                        <div
                            style={{
                                padding: "0.5rem 1rem",
                                background: "rgba(255,255,255,0.1)",
                                borderRadius: "20px",
                                display: "flex",
                                gap: "8px",
                                alignItems: "center",
                            }}
                        >
                            <span
                                style={{
                                    width: "10px",
                                    height: "10px",
                                    borderRadius: "50%",
                                    background: "#10b981",
                                    display: "inline-block",
                                }}
                            />
                            <span>{counts.total} People Present</span>
                        </div>
                    </div>
                </div>

                {/* Household check-in buttons — hidden in kiosk mode */}
                {!isKioskMode &&
                    canCheckInHousehold &&
                    household &&
                    household.leads?.some((l: { participantId: number }) => l.participantId === (session?.user as SessionUser)?.id) && (
                        <div style={{ marginBottom: "2rem" }}>
                            <h3 style={{ marginBottom: "1rem", color: "var(--color-primary-light)" }}>
                                Check In Household Members
                            </h3>
                            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                                {household.participants
                                    ?.filter((p: Participant) => !checkedInIds.includes(p.id))
                                    .map((p: Participant) => (
                                        <button
                                            key={p.id}
                                            onClick={() => handleManualCheckIn(p.id)}
                                            disabled={checkingInId === p.id}
                                            className="glass-button"
                                            style={{
                                                padding: "0.5rem 1rem",
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "0.5rem",
                                            }}
                                        >
                                            {checkingInId === p.id ? "..." : <span>{p.name || p.email}</span>}
                                        </button>
                                    ))}
                                {household.participants?.filter((p: Participant) => !checkedInIds.includes(p.id)).length ===
                                    0 && (
                                    <span
                                        style={{
                                            color: "var(--color-text-muted)",
                                            fontStyle: "italic",
                                            fontSize: "0.875rem",
                                        }}
                                    >
                                        All household members are currently checked in!
                                    </span>
                                )}
                            </div>
                        </div>
                    )}

                {/* Admin manual check-in search — hidden in kiosk mode */}
                {!isKioskMode && canManuallyCheckInGlobal && (
                    <div style={{ marginBottom: "2rem", position: "relative" }}>
                        <input
                            type="text"
                            placeholder="Manually check someone in (Search by name or email)..."
                            className="glass-input"
                            style={{
                                width: "100%",
                                padding: "0.75rem",
                                background: "rgba(0,0,0,0.2)",
                                color: "white",
                            }}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        {displayResults.length > 0 && searchQuery.length >= 2 && (
                            <div
                                style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    right: 0,
                                    background: "#1e293b",
                                    border: "1px solid rgba(255,255,255,0.1)",
                                    borderRadius: "8px",
                                    marginTop: "4px",
                                    zIndex: 10,
                                    maxHeight: "200px",
                                    overflowY: "auto",
                                }}
                            >
                                {displayResults.map((p) => (
                                    <div
                                        key={p.id}
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            padding: "0.75rem",
                                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontWeight: 500 }}>{p.name || "Unnamed"}</div>
                                            <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                                                {p.email}
                                            </div>
                                        </div>
                                        <button
                                            disabled={checkingInId === p.id}
                                            onClick={() => handleManualCheckIn(p.id)}
                                            style={{
                                                background: "rgba(59, 130, 246, 0.2)",
                                                color: "#93c5fd",
                                                border: "1px solid rgba(59, 130, 246, 0.4)",
                                                borderRadius: "4px",
                                                padding: "0.2rem 0.5rem",
                                                cursor: "pointer",
                                                fontSize: "0.8rem",
                                            }}
                                        >
                                            {checkingInId === p.id ? "..." : "Check In"}
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* Safety warnings */}
                {safety.isTwoDeepViolation && (
                    <div
                        style={{
                            background: "rgba(239, 68, 68, 0.2)",
                            border: "1px solid rgba(239, 68, 68, 0.5)",
                            color: "#fca5a5",
                            padding: "1rem",
                            borderRadius: "8px",
                            marginBottom: "1.5rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                        }}
                    >
                        <span>🚨</span>
                        <strong>Critical Warning:</strong> Two-Deep Compliance is failing! An unaccompanied
                        student is present without sufficient adult supervision.
                    </div>
                )}
                {!safety.isTwoDeepViolation && safety.isLastKeyholder && (
                    <div
                        style={{
                            background: "rgba(245, 158, 11, 0.2)",
                            border: "1px solid rgba(245, 158, 11, 0.5)",
                            color: "#fcd34d",
                            padding: "1rem",
                            borderRadius: "8px",
                            marginBottom: "1.5rem",
                            display: "flex",
                            alignItems: "center",
                            gap: "12px",
                        }}
                    >
                        <span>⚠️</span>
                        <strong>Warning:</strong> Only one keyholder is currently in the building.
                    </div>
                )}

                {/* Main content */}
                {loading ? (
                    <p style={{ color: "var(--color-text-muted)" }}>Loading attendance...</p>
                ) : error ? (
                    <div
                        style={{
                            textAlign: "center",
                            padding: "3rem",
                            color: "#fca5a5",
                            background: "rgba(239, 68, 68, 0.1)",
                            borderRadius: "8px",
                            border: "1px solid rgba(239, 68, 68, 0.3)",
                        }}
                    >
                        <p>
                            {error === "Unauthorized"
                                ? "Access Denied: Please sign in to view attendance."
                                : error}
                        </p>
                    </div>
                ) : counts.total === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-muted)" }}>
                        <p>The facility is currently empty.</p>
                    </div>
                ) : (
                    /* 3-column layout — responsive for mobile */
                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
                            gap: "1.5rem",
                        }}
                    >
                        {/* Keyholders column */}
                        <div style={{ gridColumn: counts.keyholders > 10 ? "span 2" : "auto" }}>
                            <div style={columnHeaderStyle("rgba(59, 130, 246, 0.6)")}>
                                <span style={{ fontSize: "1.25rem" }}>🔑</span>
                                <div>
                                    <div style={{ ...columnCountStyle, color: "#60a5fa" }}>
                                        {counts.keyholders}
                                    </div>
                                    <div style={columnLabelStyle}>Keyholders</div>
                                </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: counts.keyholders > 10 ? "repeat(2, 1fr)" : "1fr", gap: "0.4rem" }}>
                                {isFull
                                    ? keyholderList.map(v => renderPersonCard(v, canCheckoutVisit(v)))
                                    : householdKeyholders.map(v => renderPersonCard(v, canCheckoutVisit(v)))}
                            </div>
                        </div>

                        {/* Volunteers column */}
                        <div style={{ gridColumn: counts.volunteers > 10 ? "span 2" : "auto" }}>
                            <div style={columnHeaderStyle("rgba(16, 185, 129, 0.6)")}>
                                <span style={{ fontSize: "1.25rem" }}>🤝</span>
                                <div>
                                    <div style={{ ...columnCountStyle, color: "#34d399" }}>
                                        {counts.volunteers}
                                    </div>
                                    <div style={columnLabelStyle}>Volunteers</div>
                                </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: counts.volunteers > 10 ? "repeat(2, 1fr)" : "1fr", gap: "0.4rem" }}>
                                {isFull
                                    ? volunteerList.map(v => renderPersonCard(v, canCheckoutVisit(v)))
                                    : householdVolunteers.map(v => renderPersonCard(v, canCheckoutVisit(v)))}
                            </div>
                        </div>

                        {/* Students column */}
                        <div style={{ gridColumn: counts.students > 10 ? "span 2" : "auto" }}>
                            <div style={columnHeaderStyle("rgba(168, 85, 247, 0.6)")}>
                                <span style={{ fontSize: "1.25rem" }}>🎓</span>
                                <div>
                                    <div style={{ ...columnCountStyle, color: "#c084fc" }}>
                                        {counts.students}
                                    </div>
                                    <div style={columnLabelStyle}>Students</div>
                                </div>
                            </div>
                            <div style={{ display: "grid", gridTemplateColumns: counts.students > 10 ? "repeat(2, 1fr)" : "1fr", gap: "0.4rem" }}>
                                {isFull
                                    ? studentList.map(v => renderPersonCard(v, canCheckoutVisit(v)))
                                    : householdStudents.map(v => renderPersonCard(v, canCheckoutVisit(v)))}
                            </div>
                        </div>
                    </div>
                )}

                {/* Privacy notice for limited access */}
                {!isFull && counts.total > 0 && (
                    <div
                        style={{
                            marginTop: "1.5rem",
                            padding: "0.75rem",
                            background: "rgba(255, 255, 255, 0.03)",
                            borderRadius: "8px",
                            textAlign: "center",
                            fontSize: "0.8rem",
                            color: "var(--color-text-muted)",
                        }}
                    >
                        🔒 Individual names are only visible to administrators and on the facility kiosk.
                        {limitedHousehold.length > 0 && " Your household members are shown above."}
                    </div>
                )}
            </div>

            {/* Admin Sign Out Modal */}
            {showSignOutModal && (
                <div style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0,0,0,0.8)", zIndex: 1000, display: "flex",
                    alignItems: "center", justifyContent: "center", padding: "1rem"
                }} onClick={() => setShowSignOutModal(false)}>
                    <div style={{
                        background: "var(--color-bg)", border: "1px solid rgba(255,255,255,0.1)",
                        borderRadius: "12px", width: "100%", maxWidth: "600px",
                        maxHeight: "85vh", display: "flex", flexDirection: "column",
                        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
                    }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ padding: "1.5rem", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h2 style={{ margin: 0, fontSize: "1.25rem" }}>Sign Out A User</h2>
                            <button onClick={() => setShowSignOutModal(false)} style={{ background: "transparent", border: "none", color: "var(--color-text-muted)", cursor: "pointer", fontSize: "1.5rem" }}>&times;</button>
                        </div>
                        <div style={{ padding: "1rem 1.5rem", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                            <input
                                type="text"
                                placeholder="Search checked-in users..."
                                className="glass-input"
                                style={{ width: "100%", padding: "0.75rem", background: "rgba(0,0,0,0.2)" }}
                                value={searchSignOutQuery}
                                onChange={(e) => setSearchSignOutQuery(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div style={{ padding: "1rem 1.5rem", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            {fullAttendance.length === 0 ? (
                                <p style={{ color: "var(--color-text-muted)", textAlign: "center", padding: "2rem" }}>No one is checked in.</p>
                            ) : (
                                fullAttendance
                                    .filter(v => ((v.participant.name || "").toLowerCase().includes((searchSignOutQuery || "").toLowerCase()) || (v.participant.email || "").toLowerCase().includes((searchSignOutQuery || "").toLowerCase())))
                                    .sort((a, b) => (a.participant.name || "").localeCompare(b.participant.name || ""))
                                    .map(v => (
                                        <div key={v.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", background: "rgba(255,255,255,0.03)", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.05)" }}>
                                            <div>
                                                <div style={{ fontWeight: 500 }}>{v.participant.name || v.participant.email.split('@')[0]}</div>
                                                <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Arrived: {formatTime(v.arrived)}</div>
                                            </div>
                                            <button
                                                onClick={() => handleForceCheckout(v.id)}
                                                disabled={checkingOut === v.id}
                                                style={{
                                                    background: "rgba(239, 68, 68, 0.2)",
                                                    border: "1px solid rgba(239, 68, 68, 0.4)",
                                                    color: "#fca5a5",
                                                    padding: "0.4rem 1rem",
                                                    borderRadius: "6px",
                                                    cursor: "pointer",
                                                    fontWeight: 600,
                                                }}
                                            >
                                                {checkingOut === v.id ? "Signing Out..." : "Sign Out"}
                                            </button>
                                        </div>
                                    ))
                            )}
                        </div>
                    </div>
                </div>
            )}
        </main>
    );
}

export default function KioskDisplay() {
    return (
        <Suspense fallback={<main className={styles.main}><p style={{ color: "var(--color-text-muted)" }}>Loading...</p></main>}>
            <KioskDisplayInner />
        </Suspense>
    );
}
