"use client";

import { useEffect, useState, Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import styles from "../../page.module.css";
import { useAutoCycle } from "../../../hooks/useAutoCycle";
import { getKioskDisplayNames } from "@/lib/kiosk-names";

type ToolStatusLevel = "BASIC" | "DOF" | "CERTIFIED" | "MAY_CERTIFY_OTHERS";

type Participant = {
    id: number;
    email: string;
    name: string | null;
    ageCategory?: "ADULT" | "STUDENT";
    shopSteward?: boolean;
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
    const [isKioskMode, setIsKioskMode] = useState(searchParams.get('mode') === 'kiosk' || !!searchParams.get('sig'));
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [tools, setTools] = useState<Tool[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [currentTime, setCurrentTime] = useState<Date | null>(null);

    useEffect(() => {
        setCurrentTime(new Date());
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const fetchData = useCallback(async () => {
        try {
            // Pass kiosk signature headers if present in URL params
            const headers: Record<string, string> = {};
            const sigParam = searchParams.get("sig");
            const tsParam = searchParams.get("ts");
            const nonceParam = searchParams.get("nonce");

            if (sigParam && tsParam && nonceParam) {
                headers["x-kiosk-signature"] = sigParam;
                headers["x-kiosk-timestamp"] = tsParam;
                headers["x-kiosk-nonce"] = nonceParam;
            }

            const res = await fetch(`/api/kiosk/certifications?limit_to_present=${limitToPresent}`, { headers });
            const data = await res.json();
            if (res.ok && data.participants && data.tools) {
                setParticipants(data.participants);
                setTools(data.tools);
                setError(null);
                // If signature params were present and request succeeded, enable kiosk mode
                if (sigParam) {
                    setIsKioskMode(true);
                }
            } else if (!res.ok) {
                setError(data.error || "Failed to load certifications data");
            }
        } catch (error) {
            console.error("Failed to fetch certifications data:", error);
            setError("Network error");
        } finally {
            setLoading(false);
        }
    }, [searchParams, limitToPresent]);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    const getColorForLevel = (level: ToolStatusLevel | undefined) => {
        switch (level) {
            case "BASIC": return "#ef4444"; // Red
            case "CERTIFIED": return "#22c55e"; // Green
            case "DOF": return "#eab308"; // Yellow
            case "MAY_CERTIFY_OTHERS": return "#3b82f6"; // Blue
            default: return "transparent"; // Blank
        }
    };

    // Abbreviate tool name for kiosk: stack words vertically, shorten long words
    const compactToolName = (name: string) => {
        const MAX_WORD_LEN = 6;
        return name.split(/\s+/).map(word => {
            if (word.length > MAX_WORD_LEN) {
                return word.slice(0, MAX_WORD_LEN - 1) + '.';
            }
            return word;
        });
    };

    // Sort users alphabetically by first name (fallback to email prefix)
    const sortAlphabetically = (a: Participant, b: Participant) => {
        const nameA = a.name || a.email.split('@')[0];
        const nameB = b.name || b.email.split('@')[0];
        
        // Extract first name (assuming 'First Last' or 'Last, First' format appropriately if needed, but standard is split by space)
        // If name contains comma, it might be "Last, First", so let's handle that just in case:
        const getFirstName = (name: string) => {
            if (name.includes(',')) {
                return name.split(',')[1].trim().toLowerCase();
            }
            return name.split(' ')[0].toLowerCase();
        };

        const firstA = getFirstName(nameA);
        const firstB = getFirstName(nameB);
        
        if (firstA !== firstB) {
            return firstA.localeCompare(firstB);
        }
        return nameA.localeCompare(nameB);
    };

    const sortedParticipants = [...participants].sort(sortAlphabetically);

    // Compute privacy-friendly display names (first name only, with disambiguation)
    const displayNames = useMemo(
        () => getKioskDisplayNames(sortedParticipants),
        [sortedParticipants]
    );

    const {
        containerRef,
        visibleItems,
        currentPage,
        totalPages,
        isTransitioning
    } = useAutoCycle({
        items: sortedParticipants,
        intervalMs: 8000,
        rowHeight: 42,
        headerHeight: 42
    });

    // Reusable row render
    const renderVisitRow = (participant: Participant, index: number) => (
        <tr key={participant.id} style={{ borderBottom: index % 2 === 1 ? '3px solid rgba(255,255,255,0.8)' : '1px solid rgba(255,255,255,0.05)', transition: 'background-color 0.2s' }}>
            <td style={{ padding: isKioskMode ? '0.5rem 0.75rem' : '0.75rem 1rem', position: 'sticky', left: 0, background: 'rgba(15,23,42,0.95)', zIndex: 5, borderRight: '1px solid rgba(255,255,255,0.1)' }}>
                <div style={{ 
                    fontWeight: isKioskMode ? 700 : 500, 
                    fontSize: isKioskMode ? '1.1rem' : 'inherit',
                    letterSpacing: isKioskMode ? '0.01em' : 'normal',
                    whiteSpace: 'nowrap', 
                    overflow: 'hidden', 
                    textOverflow: 'ellipsis'
                }}>{displayNames.get(participant.id) || participant.name || participant.email.split('@')[0]}</div>
            </td>
            {tools.map((tool) => {
                const status = participant.toolStatuses.find(ts => ts.toolId === tool.id);
                let bgColor = getColorForLevel(status?.level);
                let opacity = status ? 0.8 : 1;
                
                if (participant.shopSteward) {
                    bgColor = getColorForLevel("MAY_CERTIFY_OTHERS");
                    opacity = 0.8;
                }
                
                return (
                    <td key={tool.id} style={{ padding: '0', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.05)', height: '100%' }}>
                        <div style={{
                            width: '100%',
                            height: '100%',
                            minHeight: isKioskMode ? '36px' : '48px',
                            background: bgColor,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            opacity: opacity,
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
        <main className={styles.main} style={{ 
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            padding: isKioskMode ? '1.5rem' : '2rem 1rem',
            justifyContent: 'flex-start',
            overflow: 'hidden',
            boxSizing: 'border-box',
            ...(isKioskMode ? { cursor: 'none' } : {}) 
        }}>
            <div className="glass-container" style={{ width: "100%", maxWidth: isKioskMode ? "100%" : "1200px", margin: "0 auto", padding: isKioskMode ? "0.5rem" : "1rem", overflowX: "hidden", flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'hidden', boxSizing: 'border-box' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem', flexShrink: 0 }}>
                    <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                            <h1 className="text-gradient" style={{ margin: 0, fontSize: 'clamp(1.5rem, 4vw, 2rem)' }}>Live Certifications</h1>
                            {limitToPresent ? (
                                <div style={{ padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.1)', borderRadius: '20px', display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.85rem' }}>
                                    <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981', display: 'inline-block' }}></span>
                                    <span>{participants.length} People Present</span>
                                </div>
                            ) : (
                                <div style={{ padding: '0.2rem 0.6rem', background: 'rgba(255,255,255,0.1)', borderRadius: '20px', display: 'flex', gap: '6px', alignItems: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                                    <span>{participants.length} Total Members</span>
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', fontSize: '0.8rem', flexWrap: 'wrap', padding: '0.4rem 0.8rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', alignItems: 'center', width: 'fit-content' }}>
                            <strong style={{ marginRight: '0.5rem' }}>Legend:</strong>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: '12px', height: '12px', background: '#ef4444', display: 'inline-block', borderRadius: '3px' }}></span> Basic</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: '12px', height: '12px', background: '#22c55e', display: 'inline-block', borderRadius: '3px' }}></span> Certified</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: '12px', height: '12px', background: '#eab308', display: 'inline-block', borderRadius: '3px' }}></span> DOF</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}><span style={{ width: '12px', height: '12px', background: '#3b82f6', display: 'inline-block', borderRadius: '3px' }}></span> Instructor</div>
                        </div>
                    </div>
                    {currentTime && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
                            {totalPages > 1 && (
                                <div style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--color-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                                    {currentPage + 1} / {totalPages}
                                </div>
                            )}
                            <div style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', fontWeight: 'bold', lineHeight: 1, color: 'var(--color-text-main)', opacity: 0.9, fontVariantNumeric: 'tabular-nums' }}>
                                {currentTime.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit" })}
                            </div>
                        </div>
                    )}
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
                    <div ref={containerRef} style={{ flex: 1, overflowX: 'hidden', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                        <table style={{ borderCollapse: 'collapse', textAlign: 'left', width: '100%', tableLayout: isKioskMode ? 'fixed' : undefined }}>
                            <thead style={{ position: 'sticky', top: 0, zIndex: 10 }}>
                                <tr>
                                    <th style={{ 
                                        padding: isKioskMode ? '0.5rem 0.75rem' : '1rem', 
                                        borderBottom: '1px solid rgba(255,255,255,0.1)', 
                                        background: 'rgba(255,255,255,0.05)', 
                                        position: 'sticky', 
                                        left: 0, 
                                        zIndex: 11, 
                                        backdropFilter: 'blur(10px)', 
                                        borderRight: '1px solid rgba(255,255,255,0.1)', 
                                        verticalAlign: 'bottom', 
                                        width: isKioskMode ? '12%' : '150px', 
                                        maxWidth: isKioskMode ? '200px' : '150px',
                                        fontSize: isKioskMode ? '1.1rem' : 'inherit',
                                        fontWeight: isKioskMode ? 700 : 'bold',
                                        letterSpacing: isKioskMode ? '0.01em' : 'normal',
                                        overflow: 'hidden', textOverflow: 'ellipsis'
                                    }}>
                                        Participant
                                    </th>
                                    {tools.map((tool) => (
                                        <th key={tool.id} style={{
                                            borderBottom: '1px solid rgba(255,255,255,0.1)',
                                            borderRight: '1px solid rgba(255,255,255,0.05)',
                                            background: 'rgba(255,255,255,0.02)',
                                            fontSize: isKioskMode ? '0.8rem' : '0.875rem',
                                            fontWeight: isKioskMode ? 700 : 'bold',
                                            letterSpacing: 'normal',
                                            position: 'relative',
                                            verticalAlign: 'bottom',
                                            padding: isKioskMode ? '0.4rem 0.2rem' : '0.5rem',
                                            textAlign: 'center',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'normal',
                                            wordBreak: 'break-word',
                                            hyphens: 'auto',
                                            lineHeight: 1.2
                                        }}>
                                            {isKioskMode ? (
                                                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0px', lineHeight: 1.1 }}>
                                                    {compactToolName(tool.name).map((word, i) => (
                                                        <span key={i}>{word}</span>
                                                    ))}
                                                </span>
                                            ) : (
                                                <span>{tool.name}</span>
                                            )}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody style={{ 
                                opacity: isTransitioning ? 0 : 1, 
                                transition: 'opacity 0.5s ease-in-out' 
                            }}>
                                {visibleItems.map((p, i) => renderVisitRow(p, i))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </main>
    );
}
