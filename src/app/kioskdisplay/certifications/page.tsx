"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../../page.module.css";

type ToolStatusLevel = "BASIC" | "DOF" | "CERTIFIED" | "MAY_CERTIFY_OTHERS";

type Participant = {
    id: number;
    email: string;
    name: string | null;
    ageCategory?: "ADULT" | "STUDENT";
    toolStatuses: {
        toolId: number;
        level: ToolStatusLevel;
    }[];
};

type Tool = {
    id: number;
    name: string;
};

export default function KioskCertificationsDisplay() {
    return (
        <Suspense fallback={<main className={styles.main}><div className="glass-container"><h2>Loading...</h2></div></main>}>
            <KioskCertificationsInner />
        </Suspense>
    );
}

function KioskCertificationsInner() {
    const searchParams = useSearchParams();
    const limitToPresent = searchParams.get('limit_to_present') !== 'false';
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [tools, setTools] = useState<Tool[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchData = async () => {
        try {
            const res = await fetch(`/api/kiosk/certifications?limit_to_present=${limitToPresent}`);
            const data = await res.json();
            if (res.ok && data.participants && data.tools) {
                setParticipants(data.participants);
                setTools(data.tools);
                setError(null);
            } else if (!res.ok) {
                setError(data.error || "Failed to load certifications data");
            }
        } catch (error) {
            console.error("Failed to fetch certifications data:", error);
            setError("Network error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const getColorForLevel = (level: ToolStatusLevel | undefined) => {
        switch (level) {
            case "BASIC": return "#ef4444"; // Red
            case "CERTIFIED": return "#eab308"; // Yellow
            case "DOF": return "#22c55e"; // Green
            case "MAY_CERTIFY_OTHERS": return "#3b82f6"; // Blue
            default: return "transparent"; // Blank
        }
    };

    // Sort users alphabetically by name (fallback to email prefix)
    const sortAlphabetically = (a: Participant, b: Participant) => {
        const nameA = a.name || a.email.split('@')[0];
        const nameB = b.name || b.email.split('@')[0];
        return nameA.localeCompare(nameB);
    };

    const adultVisits = participants.filter(p => p.ageCategory === "ADULT").sort(sortAlphabetically);
    const studentVisits = participants.filter(p => p.ageCategory === "STUDENT").sort(sortAlphabetically);

    // Reusable row render
    const renderVisitRow = (participant: Participant) => (
        <tr key={participant.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background-color 0.2s' }}>
            <td style={{ padding: '0.75rem 1rem', position: 'sticky', left: 0, background: 'rgba(15,23,42,0.95)', zIndex: 5, borderRight: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{participant.name || participant.email.split('@')[0]}</div>
            </td>
            {tools.map((tool) => {
                const status = participant.toolStatuses.find(ts => ts.toolId === tool.id);
                const bgColor = getColorForLevel(status?.level);
                return (
                    <td key={tool.id} style={{ padding: '0', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.05)', height: '100%' }}>
                        <div style={{
                            width: '40px',
                            minWidth: '40px',
                            height: '100%',
                            minHeight: '48px',
                            background: bgColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: status ? 0.8 : 1,
                            transition: 'opacity 0.2s',
                            margin: '0 auto'
                        }}>
                        </div>
                    </td>
                );
            })}
        </tr>
    );

    return (
        <main className={styles.main} style={{ paddingTop: '1rem', paddingBottom: '2rem' }}>
            <div className="glass-container" style={{ width: "100%", maxWidth: "1200px", padding: "1rem", overflowX: "hidden" }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0, fontSize: 'clamp(1.5rem, 5vw, 2.5rem)' }}>Live Certifications</h1>
                    {limitToPresent ? (
                        <div style={{ alignSelf: 'flex-start', padding: '0.4rem 0.8rem', background: 'rgba(255,255,255,0.1)', borderRadius: '20px', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.9rem' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                            <span>{participants.length} People Present</span>
                        </div>
                    ) : (
                        <div style={{ alignSelf: 'flex-start', padding: '0.4rem 0.8rem', background: 'rgba(255,255,255,0.1)', borderRadius: '20px', display: 'flex', gap: '8px', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                            <span>{participants.length} Total Members</span>
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', fontSize: '0.875rem', flexWrap: 'wrap', padding: '1rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                    <strong style={{ marginRight: '1rem' }}>Legend:</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ width: '16px', height: '16px', background: '#ef4444', display: 'inline-block', borderRadius: '4px' }}></span> Basic</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ width: '16px', height: '16px', background: '#eab308', display: 'inline-block', borderRadius: '4px' }}></span> Certified</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ width: '16px', height: '16px', background: '#22c55e', display: 'inline-block', borderRadius: '4px' }}></span> DOF</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><span style={{ width: '16px', height: '16px', background: '#3b82f6', display: 'inline-block', borderRadius: '4px' }}></span> Instructor</div>
                </div>

                {loading ? (
                    <p style={{ color: "var(--color-text-muted)" }}>Loading certifications...</p>
                ) : error ? (
                    <div style={{ textAlign: "center", padding: "3rem", color: "#fca5a5", background: "rgba(239, 68, 68, 0.1)", borderRadius: "8px", border: "1px solid rgba(239, 68, 68, 0.3)" }}>
                        <p>{error}</p>
                    </div>
                ) : participants.length === 0 || tools.length === 0 ? (
                    <div style={{ textAlign: "center", padding: "3rem", color: "var(--color-text-muted)" }}>
                        <p>No {limitToPresent ? "active participants" : "participants"} found.</p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', WebkitOverflowScrolling: 'touch' }}>
                        <table style={{ borderCollapse: 'collapse', textAlign: 'left', minWidth: 'max-content' }}>
                            <thead>
                                <tr>
                                    <th style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', position: 'sticky', left: 0, zIndex: 10, backdropFilter: 'blur(10px)', borderRight: '1px solid rgba(255,255,255,0.1)', verticalAlign: 'bottom' }}>
                                        Participant
                                    </th>
                                    {tools.map((tool) => (
                                        <th key={tool.id} style={{
                                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                                            borderRight: '1px solid rgba(255,255,255,0.05)',
                                            background: 'rgba(255,255,255,0.02)',
                                            fontSize: '0.875rem',
                                            height: '180px',
                                            width: '40px',
                                            position: 'relative',
                                            verticalAlign: 'bottom',
                                            padding: 0
                                        }}>
                                            <div style={{
                                                position: 'absolute',
                                                bottom: '10px',
                                                left: '50%',
                                                transformOrigin: 'bottom left',
                                                transform: 'translateX(-50%) rotate(-45deg)',
                                                whiteSpace: 'nowrap',
                                                width: '10px'
                                            }}>
                                                <span style={{ display: 'inline-block', transform: 'translateX(-100%)', paddingRight: '10px' }}>{tool.name}</span>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {adultVisits.map(renderVisitRow)}
                                
                                {studentVisits.length > 0 && adultVisits.length > 0 && (
                                    <tr>
                                        <td colSpan={tools.length + 1} style={{ 
                                            background: 'rgba(255,255,255,0.1)', 
                                            padding: '0.4rem 1rem', 
                                            fontWeight: 'bold',
                                            color: 'var(--color-primary-light)',
                                            fontSize: '0.9rem',
                                            position: 'sticky',
                                            left: 0,
                                            zIndex: 5
                                        }}>
                                            Students
                                        </td>
                                    </tr>
                                )}
                                
                                {studentVisits.map(renderVisitRow)}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </main>
    );
}
