"use client";
/* eslint-disable react-hooks/exhaustive-deps */

import { use, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../../../page.module.css';
import { formatDateTime } from '@/lib/time';

type ProgramDetail = {
    id: number;
    name: string;
    begin: string | null;
    end: string | null;
    leadMentorId: number | null;
    phase: string;
    enrollmentStatus: string;
    minAge: number | null;
    maxAge: number | null;
    maxParticipants: number | null;
    memberOnly: boolean;
    participants: {
        participantId: number;
        status: string;
        joinedAt: string | null;
        pendingSince: string | null;
        participant: { 
            name: string | null; 
            email: string;
            phone?: string | null;
            household?: {
                emergencyContactName: string | null;
                emergencyContactPhone: string | null;
            } | null;
        };
    }[];
    volunteers: {
        participantId: number;
        isCore: boolean;
        participant: { name: string | null; email: string };
    }[];
    events: {
        id: number;
        name: string;
        start: string;
        end: string;
        attendanceConfirmedAt: string | null;
    }[];
    leadMentor: { name: string | null; email: string } | null;
    memberPrice: number | null;
    nonMemberPrice: number | null;
    shopifyProductId: string | null;
};

type ParticipantOption = {
    id: number;
    name: string | null;
    email: string;
    dob?: string | null;
};

export default function ProgramDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session, status } = useSession();
    const router = useRouter();

    const [program, setProgram] = useState<ProgramDetail | null>(null);

    // Form States
    const [begin, setBegin] = useState("");
    const [end, setEnd] = useState("");
    const [minAge, setMinAge] = useState("");
    const [maxAge, setMaxAge] = useState("");
    const [maxParticipants, setMaxParticipants] = useState("");
    const [phase, setPhase] = useState("PLANNING");
    const [enrollmentStatus, setEnrollmentStatus] = useState("CLOSED");
    const [memberOnly, setMemberOnly] = useState(false);
    const [leadMentorIdInput, setLeadMentorIdInput] = useState("");
    const [memberPrice, setMemberPrice] = useState("");
    const [nonMemberPrice, setNonMemberPrice] = useState("");

    const [newVolId, setNewVolId] = useState("");

    const [newPartId, setNewPartId] = useState("");

    const [volSearch, setVolSearch] = useState("");
    const [volResults, setVolResults] = useState<ParticipantOption[]>([]);
    const [volSearching, setVolSearching] = useState(false);

    const [mentorSearch, setMentorSearch] = useState("");
    const [mentorResults, setMentorResults] = useState<ParticipantOption[]>([]);
    const [mentorSearching, setMentorSearching] = useState(false);
    const [isEditingMentor, setIsEditingMentor] = useState(false);

    const [partSearch, setPartSearch] = useState("");
    const [partResults, setPartResults] = useState<ParticipantOption[]>([]);
    const [partSearching, setPartSearching] = useState(false);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [activeTab, setActiveTab] = useState<'general' | 'roster' | 'events'>('general');

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            fetchProgram();
        }
    }, [status, router, id]);

    const searchParticipants = useCallback(async (
        query: string, 
        setResults: React.Dispatch<React.SetStateAction<ParticipantOption[]>>, 
        setLocalLoading: React.Dispatch<React.SetStateAction<boolean>>
    ) => {
        if (!query.trim()) {
            setResults([]);
            return;
        }
        setLocalLoading(true);
        try {
            const res = await fetch(`/api/programs/${id}/eligible-participants?q=${encodeURIComponent(query)}`);
            if (res.ok) {
                const data = await res.json();
                setResults(data.members || []);
            }
        } finally {
            setLocalLoading(false);
        }
    }, [id]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (volSearch && !newVolId) {
                searchParticipants(volSearch, setVolResults, setVolSearching);
            } else if (!volSearch) {
                setVolResults([]);
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [volSearch, newVolId, id, searchParticipants]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (mentorSearch && !leadMentorIdInput) {
                const searchMentors = async () => {
                    setMentorSearching(true);
                    try {
                        const res = await fetch(`/api/admin/participants/search?q=${encodeURIComponent(mentorSearch)}&filter=adults`);
                        if (res.ok) {
                            const data = await res.json();
                            setMentorResults(data.participants || []);
                        }
                    } finally {
                        setMentorSearching(false);
                    }
                };
                searchMentors();
            } else if (!mentorSearch) {
                setMentorResults([]);
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [mentorSearch, leadMentorIdInput]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (partSearch && !newPartId) {
                searchParticipants(partSearch, setPartResults, setPartSearching);
            } else if (!partSearch) {
                setPartResults([]);
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [partSearch, newPartId, id, searchParticipants]);

    const fetchProgram = async () => {
        try {
            const res = await fetch(`/api/programs/${id}`);
            if (res.ok) {
                const data = await res.json();
                setProgram(data);

                // Initialize form
                if (data.begin) setBegin(data.begin.split('T')[0]);
                if (data.end) setEnd(data.end.split('T')[0]);
                setMinAge(data.minAge !== null ? String(data.minAge) : "");
                setMaxAge(data.maxAge !== null ? String(data.maxAge) : "");
                setPhase(data.phase || "PLANNING");
                setEnrollmentStatus(data.enrollmentStatus || "CLOSED");
                setMemberOnly(Boolean(data.memberOnly));
                setLeadMentorIdInput(data.leadMentorId !== null ? String(data.leadMentorId) : "");
                setMemberPrice(data.memberPrice !== null ? String(data.memberPrice) : "");
                setNonMemberPrice(data.nonMemberPrice !== null ? String(data.nonMemberPrice) : "");
                if (data.leadMentor) {
                    setMentorSearch(`${data.leadMentor.name || 'Unnamed'} (${data.leadMentor.email})`);
                } else {
                    setMentorSearch("");
                }
                setIsEditingMentor(false);
            } else if (res.status === 404) {
                setMessage("Program not found.");
            } else {
                setMessage("Failed to load program.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setLoading(false);
        }
    };



    const handleSaveGeneral = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage("");

        try {
            const res = await fetch(`/api/programs/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    begin: begin || null,
                    end: end || null,
                    minAge: minAge ? parseInt(minAge) : null,
                    maxAge: maxAge ? parseInt(maxAge) : null,
                    maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
                    phase,
                    enrollmentStatus,
                    memberOnly,
                    leadMentorId: leadMentorIdInput ? parseInt(leadMentorIdInput) : null,
                    memberPrice: memberPrice ? parseInt(memberPrice) : null,
                    nonMemberPrice: nonMemberPrice ? parseInt(nonMemberPrice) : null,
                })
            });

            if (res.ok) {
                setMessage("Settings updated successfully.");
                fetchProgram();
            } else {
                const data = await res.json();
                setMessage(data.error || "Failed to save settings.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setSaving(false);
        }
    };

    const handleAddVolunteer = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newVolId) return;

        setSaving(true);
        try {
            const res = await fetch(`/api/programs/${id}/volunteers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantId: parseInt(newVolId)
                })
            });
            if (res.ok) {
                setNewVolId("");
                setVolSearch("");
                fetchProgram();
            }
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveVolunteer = async (participantId: number) => {
        if (!confirm("Remove this volunteer?")) return;
        try {
            await fetch(`/api/programs/${id}/volunteers`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId })
            });
            fetchProgram();
        } catch { }
    };

    const handleToggleCore = async (participantId: number, isCore: boolean) => {
        setSaving(true);
        try {
            const res = await fetch(`/api/programs/${id}/volunteers`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId, isCore })
            });
            if (res.ok) {
                fetchProgram();
            }
        } finally {
            setSaving(false);
        }
    };

    const handleAddParticipant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newPartId) return;

        // Board member bypass warning
        const user = session?.user as { sysadmin?: boolean; boardMember?: boolean } | undefined;
        if (user?.sysadmin || user?.boardMember) {
            if (!confirm("Warning: Adding a participant manually bypasses all payment requirements. Are you sure you wish to proceed?")) {
                return;
            }
        }

        setSaving(true);
        setMessage("");
        try {
            const res = await fetch(`/api/programs/${id}/participants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantId: parseInt(newPartId),
                    override: true
                })
            });
            if (res.ok) {
                setNewPartId("");
                setPartResults([]);
                setPartSearch("");
                fetchProgram();
            } else {
                const data = await res.json();
                setMessage(data.error || "Failed to enroll participant.");
            }
        } finally {
            setSaving(false);
        }
    };

    const handleRemoveParticipant = async (participantId: number) => {
        if (!confirm("Remove this participant?")) return;
        try {
            await fetch(`/api/programs/${id}/participants`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId })
            });
            fetchProgram();
        } catch { }
    };

    if (loading || status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading...</h2>
                </div>
            </main>
        );
    }

    if (!session || !program) return (
        <main className={styles.main}>
            <div className="glass-container animate-float">
                <h2>{message || "Not Found"}</h2>
                <button className="glass-button" onClick={() => router.push('/programs')}>Back</button>
            </div>
        </main>
    );

    const user = session.user as unknown as { id: number; sysadmin?: boolean; boardMember?: boolean };
    const isAuthorized = program.leadMentorId === user?.id || user?.sysadmin || user?.boardMember;

    const activeParticipants = program.participants.filter(p => p.status === 'ACTIVE');
    const pendingParticipants = program.participants.filter(p => p.status === 'PENDING');

    if (!isAuthorized) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Forbidden: Not authorized to manage this program.</h2>
                    <button className="glass-button" onClick={() => router.push('/programs')}>Back</button>
                </div>
            </main>
        );
    }

    const sortedVolunteers = program.volunteers ? [...program.volunteers].sort((a, b) => (b.isCore ? 1 : 0) - (a.isCore ? 1 : 0)) : [];

    const isSysAdminOrBoard = user?.sysadmin || user?.boardMember;

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>
                        {program.name}
                        {program.phase === 'PLANNING' && <span style={{ fontSize: '1rem', background: 'rgba(148, 163, 184, 0.25)', color: '#cbd5e1', padding: '0.2rem 0.5rem', borderRadius: '4px', verticalAlign: 'middle', marginLeft: '0.5rem', border: '1px solid rgba(148, 163, 184, 0.4)' }}>Planning</span>}
                        {program.phase === 'UPCOMING' && <span style={{ fontSize: '1rem', background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24', padding: '0.2rem 0.5rem', borderRadius: '4px', verticalAlign: 'middle', marginLeft: '0.5rem', border: '1px solid rgba(251, 191, 36, 0.4)' }}>Upcoming</span>}
                        {program.phase === 'RUNNING' && <span style={{ fontSize: '1rem', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '0.2rem 0.5rem', borderRadius: '4px', verticalAlign: 'middle', marginLeft: '0.5rem', border: '1px solid rgba(56, 189, 248, 0.4)' }}>Running</span>}
                        {program.phase === 'FINISHED' && <span style={{ fontSize: '1rem', background: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '0.2rem 0.5rem', borderRadius: '4px', verticalAlign: 'middle', marginLeft: '0.5rem', border: '1px solid rgba(16, 185, 129, 0.4)' }}>Finished</span>}
                    </h1>
                    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                        <button 
                            className="glass-button" 
                            onClick={() => {
                                const url = `${window.location.origin}/programs/${program.id}`;
                                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
                                const link = document.createElement('a');
                                link.href = qrUrl;
                                link.download = `QR_${program.name.replace(/[^a-z0-9]/gi, '_')}.png`;
                                link.target = '_blank';
                                document.body.appendChild(link);
                                link.click();
                                document.body.removeChild(link);
                            }} 
                            style={{ padding: '0.5rem 1rem', background: 'rgba(56, 189, 248, 0.2)', borderColor: 'rgba(56, 189, 248, 0.5)' }}
                        >
                            <span style={{ marginRight: '0.5rem' }}>📷</span> Download QR
                        </button>
                        <button className="glass-button" onClick={() => router.push('/programs')} style={{ padding: '0.5rem 1rem' }}>
                            &larr; Back to Programs
                        </button>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid rgba(255,255,255,0.1)', marginBottom: '2rem' }}>
                    <button
                        onClick={() => setActiveTab('general')}
                        style={{ padding: '0.75rem 1.5rem', background: 'none', border: 'none', color: activeTab === 'general' ? '#60a5fa' : 'white', borderBottom: activeTab === 'general' ? '2px solid #60a5fa' : 'none', cursor: 'pointer', fontWeight: 500 }}
                    >General</button>
                    <button
                        onClick={() => setActiveTab('roster')}
                        style={{ padding: '0.75rem 1.5rem', background: 'none', border: 'none', color: activeTab === 'roster' ? '#60a5fa' : 'white', borderBottom: activeTab === 'roster' ? '2px solid #60a5fa' : 'none', cursor: 'pointer', fontWeight: 500 }}
                    >Roster</button>
                    <button
                        onClick={() => setActiveTab('events')}
                        style={{ padding: '0.75rem 1.5rem', background: 'none', border: 'none', color: activeTab === 'events' ? '#60a5fa' : 'white', borderBottom: activeTab === 'events' ? '2px solid #60a5fa' : 'none', cursor: 'pointer', fontWeight: 500 }}
                    >Events</button>
                </div>

                {message && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '8px', color: '#38bdf8' }}>
                        {message}
                    </div>
                )}

                {activeTab === 'general' && (
                    <form onSubmit={handleSaveGeneral}>
                        <div style={{ display: 'grid', gap: '2rem', marginBottom: '2rem' }}>
                            {/* Metadata Stats Row */}
                            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{program.participants?.length || 0} {program.maxParticipants ? `/ ${program.maxParticipants}` : ''}</div>
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Participants Enrolled</div>
                                </div>
                                <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '2rem' }}></div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{program.volunteers?.length || 0}</div>
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Assigned Volunteers</div>
                                </div>
                                <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', height: '2rem' }}></div>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: 'white' }}>{program.events?.length || 0}</div>
                                    <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>Scheduled Sessions</div>
                                </div>
                            </div>

                            {/* Optional: Add a subtle status indicator for Shopify */}
                            {program.shopifyProductId && (
                                <div style={{ gridColumn: '1 / -1', background: 'rgba(34, 197, 94, 0.1)', padding: '0.75rem', borderRadius: '4px', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#4ade80', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                    ✓ Pre-configured for Shopify Checkout (Product ID: {program.shopifyProductId})
                                </div>
                            )}
                        </div>



                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem', marginBottom: '2rem' }}>
                            <div style={{ gridColumn: '1 / -1', background: 'rgba(255,255,255,0.05)', padding: '1rem', borderRadius: '8px' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Lead Mentor / Program Coordinator</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                    {isSysAdminOrBoard ? (
                                        <>
                                            {program.leadMentor && !isEditingMentor ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
                                                    <span style={{ fontSize: '1.1rem', color: '#4ade80' }}>
                                                        {program.leadMentor.name || 'Unnamed'} ({program.leadMentor.email})
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => { setIsEditingMentor(true); setMentorSearch(""); setLeadMentorIdInput(""); }}
                                                        style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '0.4rem 0.8rem', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}
                                                    >
                                                        Change
                                                    </button>
                                                </div>
                                            ) : (
                                                <div style={{ position: 'relative', flex: 1, minWidth: '250px' }}>
                                                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                                        <input
                                                            type="text"
                                                            className="glass-input"
                                                            value={mentorSearch}
                                                            onChange={e => { setMentorSearch(e.target.value); setLeadMentorIdInput(""); }}
                                                            style={{ width: '100%', padding: '0.75rem' }}
                                                            placeholder="Search Adult Members..."
                                                        />
                                                        {program.leadMentor && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setIsEditingMentor(false);
                                                                    setLeadMentorIdInput(String(program.leadMentorId));
                                                                    setMentorSearch(`${program.leadMentor?.name || 'Unnamed'} (${program.leadMentor?.email})`);
                                                                }}
                                                                style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.5rem', fontSize: '0.9rem' }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        )}
                                                    </div>
                                                    {mentorSearching && <div style={{ position: 'absolute', right: '10px', top: '15px', color: 'gray', fontSize: '0.8rem' }}>Loading...</div>}
                                                    {mentorResults.length > 0 && !leadMentorIdInput && (
                                                        <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', zIndex: 10, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', marginTop: '4px' }}>
                                                            {mentorResults.map(p => (
                                                                <div key={p.id} onClick={() => { setLeadMentorIdInput(p.id.toString()); setMentorSearch(`${p.name || 'Unnamed'} (${p.email})`); setMentorResults([]); }} style={{ padding: '0.75rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                                    <div style={{ fontWeight: 500 }}>{p.name || 'Unnamed'}</div>
                                                                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{p.email}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            {program.leadMentor ? (
                                                <span style={{ fontSize: '1.1rem', color: '#4ade80' }}>
                                                    {program.leadMentor.name || 'Unnamed'} ({program.leadMentor.email})
                                                </span>
                                            ) : (
                                                <span style={{ fontSize: '1rem', color: 'gray' }}>No Lead Mentor Assigned</span>
                                            )}
                                        </>
                                    )}
                                </div>
                                {!isSysAdminOrBoard && <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>*Only Administrators/Board Members can change the Lead Mentor ID.</p>}
                                {isSysAdminOrBoard && <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: '#fcd34d' }}>*You have permission to reassign this program. Enter the Participant ID of the new Lead Mentor.</p>}
                            </div >

                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                    Start Date
                                    {program.begin && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>(Current: {program.begin.split('T')[0]})</span>}
                                </label>
                                <input type="date" className="glass-input" value={begin} onChange={e => setBegin(e.target.value)} style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                    End Date
                                    {program.end && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>(Current: {program.end.split('T')[0]})</span>}
                                </label>
                                <input type="date" className="glass-input" value={end} onChange={e => setEnd(e.target.value)} style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                    Minimum Age (Optional)
                                    {program.minAge !== null && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>(Current: {program.minAge})</span>}
                                </label>
                                <input type="number" className="glass-input" value={minAge} onChange={e => setMinAge(e.target.value)} placeholder="e.g. 14" style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                    Maximum Age (Optional)
                                    {program.maxAge !== null && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>(Current: {program.maxAge})</span>}
                                </label>
                                <input type="number" className="glass-input" value={maxAge} onChange={e => setMaxAge(e.target.value)} placeholder="e.g. 18" style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                    Max Participants (Optional)
                                    {program.maxParticipants !== null && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>(Current: {program.maxParticipants})</span>}
                                </label>
                                <input type="number" className="glass-input" value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} placeholder="e.g. 20" style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            
                            <div style={{ display: 'flex', gap: '1rem', gridColumn: '1 / -1', flexWrap: 'wrap' }}>
                                <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                        Member Price ($)
                                        {program.memberPrice !== null && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>(Current: ${program.memberPrice})</span>}
                                    </label>
                                    <input type="number" className="glass-input" value={memberPrice} onChange={e => setMemberPrice(e.target.value)} disabled={!isSysAdminOrBoard} style={{ width: '100%', padding: '0.75rem', boxSizing: 'border-box', opacity: !isSysAdminOrBoard ? 0.5 : 1 }} title={!isSysAdminOrBoard ? "Only Board Members can alter program pricing." : ""} />
                                </div>
                                <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                        Non-Member Price ($)
                                        {program.nonMemberPrice !== null && <span style={{ marginLeft: '0.5rem', fontSize: '0.85rem', color: 'var(--color-primary)' }}>(Current: ${program.nonMemberPrice})</span>}
                                    </label>
                                    <input type="number" className="glass-input" value={nonMemberPrice} onChange={e => setNonMemberPrice(e.target.value)} disabled={!isSysAdminOrBoard} style={{ width: '100%', padding: '0.75rem', boxSizing: 'border-box', opacity: !isSysAdminOrBoard ? 0.5 : 1 }} title={!isSysAdminOrBoard ? "Only Board Members can alter program pricing." : ""} />
                                </div>
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" id="memberOnly" checked={memberOnly} onChange={e => setMemberOnly(e.target.checked)} style={{ width: '1.2rem', height: '1.2rem' }} />
                                <label htmlFor="memberOnly" style={{ fontWeight: 500, cursor: 'pointer' }}>Member-Only Program</label>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontWeight: 500 }}>Program Phase</label>
                                <select className="glass-input" value={phase} onChange={e => setPhase(e.target.value)} style={{ padding: '0.75rem', width: '100%', background: 'rgba(0,0,0,0.5)', color: 'white' }}>
                                    <option value="PLANNING" style={{ color: 'white', background: '#1e293b' }}>Planning (Draft)</option>
                                    <option value="UPCOMING" style={{ color: 'white', background: '#1e293b' }}>Upcoming (Published)</option>
                                    <option value="RUNNING" style={{ color: 'white', background: '#1e293b' }}>Currently Running</option>
                                    <option value="FINISHED" style={{ color: 'white', background: '#1e293b' }}>Finished</option>
                                </select>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontWeight: 500 }}>Enrollment Status</label>
                                <select className="glass-input" value={enrollmentStatus} onChange={e => setEnrollmentStatus(e.target.value)} style={{ padding: '0.75rem', width: '100%', background: 'rgba(0,0,0,0.5)', color: 'white' }}>
                                    <option value="OPEN" style={{ color: 'white', background: '#1e293b' }}>Open for Enrollment</option>
                                    <option value="CLOSED" style={{ color: 'white', background: '#1e293b' }}>Closed for Enrollment (Full / Stopped)</option>
                                </select>
                            </div>
                        </div >
                        <button type="submit" className="glass-button" disabled={saving} style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                            {saving ? "Saving..." : "Save Settings"}
                        </button>
                    </form >
                )
                }

                {
                    activeTab === 'roster' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
                            {/* Volunteers Section */}
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                                <h3 style={{ margin: '0 0 1rem 0' }}>Volunteers ({program.volunteers.length})</h3>

                                <form onSubmit={handleAddVolunteer} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Assign Volunteer (Name/Email)</label>
                                        <input type="text" className="glass-input" value={volSearch} onChange={e => { setVolSearch(e.target.value); setNewVolId(""); }} placeholder="Start typing to search..." style={{ width: '100%', padding: '0.5rem' }} />
                                        {volSearching && <div style={{ position: 'absolute', right: '10px', top: '35px', color: 'gray', fontSize: '0.8rem' }}>Loading...</div>}
                                        {volResults.length > 0 && !newVolId && (
                                            <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', zIndex: 10, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', marginTop: '4px' }}>
                                                {volResults.map(p => (
                                                    <div key={p.id} onClick={() => { setNewVolId(p.id.toString()); setVolSearch(`${p.name || 'Unnamed'} (${p.email})`); setVolResults([]); }} style={{ padding: '0.75rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                        <div style={{ fontWeight: 500 }}>{p.name || 'Unnamed'}</div>
                                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{p.email}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <button type="submit" className="glass-button" disabled={saving || !newVolId} style={{ padding: '0.5rem 1rem' }}>Add</button>
                                </form>

                                {program.volunteers.length === 0 ? <p style={{ color: 'gray', margin: 0 }}>No volunteers assigned.</p> :
                                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {sortedVolunteers.map(v => (
                                            <li key={v.participantId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.75rem 1rem', borderRadius: '4px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                                                    <span style={{ fontWeight: 500 }}>
                                                        {v.participant.name || 'Unnamed'} <span style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', fontWeight: 400 }}>({v.participant.email})</span>
                                                    </span>
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', cursor: 'pointer', background: v.isCore ? 'rgba(234, 179, 8, 0.2)' : 'rgba(255,255,255,0.1)', color: v.isCore ? '#eab308' : '#cbd5e1', padding: '0.2rem 0.5rem', borderRadius: '4px', border: v.isCore ? '1px solid rgba(234, 179, 8, 0.5)' : '1px solid transparent' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={v.isCore}
                                                            onChange={e => handleToggleCore(v.participantId, e.target.checked)}
                                                            disabled={saving}
                                                            style={{ cursor: 'pointer' }}
                                                        />
                                                        Core Volunteer
                                                    </label>
                                                </div>
                                                <button onClick={() => handleRemoveVolunteer(v.participantId)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0.25rem 0.5rem' }}>Remove</button>
                                            </li>
                                        ))}
                                    </ul>
                                }
                            </div>

                            {/* Participants Section */}
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                                <h3 style={{ margin: '0 0 1rem 0' }}>Active Participants ({activeParticipants.length})</h3>

                                <form onSubmit={handleAddParticipant} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '200px', position: 'relative' }}>
                                        <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Assign Participant (Name/Email)</label>
                                        <input type="text" className="glass-input" value={partSearch} onChange={e => { setPartSearch(e.target.value); setNewPartId(""); }} placeholder="Start typing to search..." style={{ width: '100%', padding: '0.5rem' }} />
                                        {partSearching && <div style={{ position: 'absolute', right: '10px', top: '35px', color: 'gray', fontSize: '0.8rem' }}>Loading...</div>}
                                        {partResults.length > 0 && !newPartId && (
                                            <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', zIndex: 10, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', marginTop: '4px' }}>
                                                {partResults.map(p => {
                                                    let warning = null;
                                                    if (p.dob) {
                                                        const ageDifMs = Date.now() - new Date(p.dob).getTime();
                                                        const ageDate = new Date(ageDifMs);
                                                        const age = Math.abs(ageDate.getUTCFullYear() - 1970);
                                                        if (program?.minAge !== null && program?.minAge !== undefined && age < program.minAge) warning = `⚠️ Too Young (${age})`;
                                                        if (program?.maxAge !== null && program?.maxAge !== undefined && age > program.maxAge) warning = `⚠️ Too Old (${age})`;
                                                    }
                                                    return (
                                                        <div key={p.id} onClick={() => { setNewPartId(p.id.toString()); setPartSearch(`${p.name || 'Unnamed'} (${p.email})`); setPartResults([]); }} style={{ padding: '0.75rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <div>
                                                                <div style={{ fontWeight: 500 }}>{p.name || 'Unnamed'}</div>
                                                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{p.email}</div>
                                                            </div>
                                                            {warning && <div style={{ fontSize: '0.75rem', color: '#fbbf24', background: 'rgba(251, 191, 36, 0.2)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>{warning}</div>}
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        )}
                                    </div>
                                    {!isSysAdminOrBoard ? (
                                        <p style={{ color: '#fbbf24', fontSize: '0.9rem', marginTop: '1rem', padding: '0.5rem', background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.3)', borderRadius: '4px' }}>
                                            ⚠️ Program Leads cannot manually enroll participants. Participants must enroll themselves and complete payment via Shopify.
                                        </p>
                                    ) : (
                                        <button type="submit" className="glass-button" disabled={saving || !newPartId} style={{ padding: '0.5rem 1rem' }}>Enroll</button>
                                    )}
                                </form>

                                {activeParticipants.length === 0 ? <p style={{ color: 'gray', margin: 0 }}>No active participants yet.</p> :
                                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {activeParticipants.map(p => (
                                            <li key={p.participantId} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.05)', padding: '0.75rem 1rem', borderRadius: '4px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', color: 'var(--color-primary)' }}>{p.participant.name || 'Unnamed'}</span>
                                                    <button onClick={() => handleRemoveParticipant(p.participantId)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.25rem 0.5rem' }}>Remove</button>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                                                    <div><strong>Email:</strong> {p.participant.email}</div>
                                                    <div><strong>Phone:</strong> {p.participant.phone || 'N/A'}</div>
                                                    <div><strong>Joined:</strong> {p.joinedAt ? formatDateTime(p.joinedAt) : 'N/A'}</div>
                                                    {p.participant.household && (
                                                        <div style={{ gridColumn: '1 / -1', background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '4px', marginTop: '0.25rem' }}>
                                                            <strong>Emergency Contact:</strong> {p.participant.household.emergencyContactName || 'N/A'} - {p.participant.household.emergencyContactPhone || 'N/A'}
                                                        </div>
                                                    )}
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                }
                            </div>

                            {/* Pending Participants Section */}
                            <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                                <h3 style={{ margin: '0 0 1rem 0' }}>Pending Participants ({pendingParticipants.length})</h3>
                                {pendingParticipants.length === 0 ? <p style={{ color: 'gray', margin: 0 }}>No pending participants.</p> :
                                    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {pendingParticipants.map(p => (
                                            <li key={p.participantId} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.05)', padding: '0.75rem 1rem', borderRadius: '4px' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', color: '#fbbf24' }}>{p.participant.name || 'Unnamed'}</span>
                                                    <button onClick={() => handleRemoveParticipant(p.participantId)} style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.25rem 0.5rem' }}>Remove</button>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                                                    <div><strong>Email:</strong> {p.participant.email}</div>
                                                    <div><strong>Phone:</strong> {p.participant.phone || 'N/A'}</div>
                                                    <div><strong>Pending Since:</strong> {p.pendingSince ? formatDateTime(p.pendingSince) : 'Unknown'}</div>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                }
                            </div>
                        </div>
                    )
                }

                {
                    activeTab === 'events' && (
                        <div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <h3 style={{ margin: 0 }}>Events ({program.events.length})</h3>
                                <button className="glass-button" onClick={() => router.push(`/admin/events/new?programId=${program.id}`)} style={{ padding: '0.5rem 1rem', background: 'rgba(56, 189, 248, 0.2)', borderColor: 'rgba(56, 189, 248, 0.5)' }}>
                                    + Schedule Session(s)
                                </button>
                            </div>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
                                            <th style={{ padding: '0.75rem' }}>Event Name</th>
                                            <th style={{ padding: '0.75rem' }}>Start Time</th>
                                            <th style={{ padding: '0.75rem', textAlign: 'right' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {program.events.map(ev => {
                                            const isPastEvent = new Date(ev.end) < new Date();
                                            const needsConfirmation = isPastEvent && !ev.attendanceConfirmedAt;

                                            return (
                                                <tr key={ev.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                            {ev.name}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '0.75rem', color: 'var(--color-text-muted)' }}>{formatDateTime(ev.start)}</td>
                                                    <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                        {needsConfirmation ? (
                                                            <Link href={`/admin/events/${ev.id}`} className="glass-button" style={{ display: 'inline-block', color: '#eab308', background: 'rgba(234, 179, 8, 0.2)', padding: '0.4rem 0.8rem', border: '1px solid rgba(234, 179, 8, 0.5)', borderRadius: '4px', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                                                Confirm Attendance
                                                            </Link>
                                                        ) : (
                                                            <Link href={`/admin/events/${ev.id}`} style={{ color: '#60a5fa', textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                                                {isPastEvent ? 'Attendance \u2192' : 'Edit Event \u2192'}
                                                            </Link>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {program.events.length === 0 && (
                                            <tr>
                                                <td colSpan={3} style={{ padding: '1.5rem', textAlign: 'center', color: 'gray' }}>No events scheduled.</td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )
                }

            </div >
        </main >
    );
}
