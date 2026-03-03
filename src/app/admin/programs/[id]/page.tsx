"use client";

import { use, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../../../page.module.css';

type ProgramDetail = {
    id: number;
    name: string;
    begin: string | null;
    end: string | null;
    leadMentorId: number | null;
    isPublished: boolean;
    minAge: number | null;
    maxParticipants: number | null;
    memberOnly: boolean;
    participants: {
        participantId: number;
        participant: { name: string | null; email: string };
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
    }[];
};

type ParticipantOption = {
    id: number;
    name: string | null;
    email: string;
};

export default function ProgramDetailsPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session, status } = useSession();
    const router = useRouter();

    const [program, setProgram] = useState<ProgramDetail | null>(null);
    const [allParticipants, setAllParticipants] = useState<ParticipantOption[]>([]);

    // Form States
    const [begin, setBegin] = useState("");
    const [end, setEnd] = useState("");
    const [minAge, setMinAge] = useState("");
    const [maxParticipants, setMaxParticipants] = useState("");
    const [isPublished, setIsPublished] = useState(false);
    const [memberOnly, setMemberOnly] = useState(false);

    // Volunteer Form
    const [newVolId, setNewVolId] = useState("");
    const [newVolCore, setNewVolCore] = useState(false);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [activeTab, setActiveTab] = useState<'general' | 'roster' | 'events'>('general');

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            fetchProgram();
            fetchAllParticipants();
        }
    }, [status, router, id]);

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
                setMaxParticipants(data.maxParticipants !== null ? String(data.maxParticipants) : "");
                setIsPublished(Boolean(data.isPublished));
                setMemberOnly(Boolean(data.memberOnly));
            } else if (res.status === 404) {
                setMessage("Program not found.");
            } else {
                setMessage("Failed to load program.");
            }
        } catch (error) {
            setMessage("Network error.");
        } finally {
            setLoading(false);
        }
    };

    const fetchAllParticipants = async () => {
        try {
            const res = await fetch('/api/household/member'); // Getting all available members/participants
            if (res.ok) {
                const data = await res.json();
                setAllParticipants(data.members || []);
            }
        } catch {
            // silent fail
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
                    maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
                    isPublished,
                    memberOnly
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
                    participantId: parseInt(newVolId),
                    isCore: newVolCore
                })
            });
            if (res.ok) {
                setNewVolId("");
                setNewVolCore(false);
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

    const handleAddParticipant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newVolId) return; // Reusing state for the same lookup

        setSaving(true);
        setMessage("");
        try {
            const res = await fetch(`/api/programs/${id}/participants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantId: parseInt(newVolId),
                    override: true
                })
            });
            if (res.ok) {
                setNewVolId("");
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
                <button className="glass-button" onClick={() => router.push('/admin/programs')}>Back</button>
            </div>
        </main>
    );

    const isAuthorized = program.leadMentorId === (session.user as any)?.id || (session.user as any)?.sysadmin || (session.user as any)?.boardMember;

    if (!isAuthorized) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Forbidden: Not authorized to manage this program.</h2>
                    <button className="glass-button" onClick={() => router.push('/admin/programs')}>Back</button>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>
                        {program.name} {program.isPublished ? <span style={{ fontSize: '1rem', background: '#4ade80', color: '#000', padding: '0.2rem 0.5rem', borderRadius: '4px', verticalAlign: 'middle' }}>Published</span> : <span style={{ fontSize: '1rem', background: '#fbbf24', color: '#000', padding: '0.2rem 0.5rem', borderRadius: '4px', verticalAlign: 'middle' }}>Draft</span>}
                    </h1>
                    <button className="glass-button" onClick={() => router.push('/admin/programs')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Back to Programs
                    </button>
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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Start Date</label>
                                <input type="date" className="glass-input" value={begin} onChange={e => setBegin(e.target.value)} style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>End Date</label>
                                <input type="date" className="glass-input" value={end} onChange={e => setEnd(e.target.value)} style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Minimum Age (Optional)</label>
                                <input type="number" className="glass-input" value={minAge} onChange={e => setMinAge(e.target.value)} placeholder="e.g. 14" style={{ width: '100%', padding: '0.75rem' }} />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Max Participants (Optional)</label>
                                <input type="number" className="glass-input" value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} placeholder="e.g. 20" style={{ width: '100%', padding: '0.75rem' }} />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" id="memberOnly" checked={memberOnly} onChange={e => setMemberOnly(e.target.checked)} style={{ width: '1.2rem', height: '1.2rem' }} />
                                <label htmlFor="memberOnly" style={{ fontWeight: 500, cursor: 'pointer' }}>Member-Only Program</label>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <input type="checkbox" id="isPublished" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} style={{ width: '1.2rem', height: '1.2rem' }} />
                                <label htmlFor="isPublished" style={{ fontWeight: 500, cursor: 'pointer' }}>Published (Visible to public)</label>
                            </div>
                        </div>
                        <button type="submit" className="glass-button" disabled={saving} style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                            {saving ? "Saving..." : "Save Settings"}
                        </button>
                    </form>
                )}

                {activeTab === 'roster' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3rem' }}>
                        {/* Volunteers Section */}
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 1rem 0' }}>Volunteers ({program.volunteers.length})</h3>

                            <form onSubmit={handleAddVolunteer} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Assign Volunteer</label>
                                    <select className="glass-input" value={newVolId} onChange={e => setNewVolId(e.target.value)} style={{ width: '100%', padding: '0.5rem' }} required>
                                        <option value="">-- Select Member --</option>
                                        {allParticipants.map(p => (
                                            <option key={p.id} value={p.id}>{p.name || 'Unnamed'} ({p.email})</option>
                                        ))}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', paddingBottom: '0.5rem' }}>
                                    <input type="checkbox" id="isCore" checked={newVolCore} onChange={e => setNewVolCore(e.target.checked)} />
                                    <label htmlFor="isCore">Core Staff</label>
                                </div>
                                <button type="submit" className="glass-button" disabled={saving || !newVolId} style={{ padding: '0.5rem 1rem' }}>Add</button>
                            </form>

                            {program.volunteers.length === 0 ? <p style={{ color: 'gray', margin: 0 }}>No volunteers assigned.</p> :
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {program.volunteers.map(v => (
                                        <li key={v.participantId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.5rem 1rem', borderRadius: '4px' }}>
                                            <span>
                                                {v.participant.name || 'Unnamed'} ({v.participant.email})
                                                {v.isCore && <span style={{ marginLeft: '0.5rem', background: '#eab308', color: '#000', fontSize: '0.8rem', padding: '0.1rem 0.3rem', borderRadius: '4px' }}>Core</span>}
                                            </span>
                                            <button onClick={() => handleRemoveVolunteer(v.participantId)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>Remove</button>
                                        </li>
                                    ))}
                                </ul>
                            }
                        </div>

                        {/* Participants Section */}
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                            <h3 style={{ margin: '0 0 1rem 0' }}>Enrolled Participants ({program.participants.length})</h3>

                            <form onSubmit={handleAddParticipant} style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                <div style={{ flex: 1, minWidth: '200px' }}>
                                    <label style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem' }}>Assign Participant</label>
                                    <select className="glass-input" value={newVolId} onChange={e => setNewVolId(e.target.value)} style={{ width: '100%', padding: '0.5rem' }} required>
                                        <option value="">-- Select Member --</option>
                                        {allParticipants.map(p => (
                                            <option key={p.id} value={p.id}>{p.name || 'Unnamed'} ({p.email})</option>
                                        ))}
                                    </select>
                                </div>
                                <button type="submit" className="glass-button" disabled={saving || !newVolId} style={{ padding: '0.5rem 1rem' }}>Enroll</button>
                            </form>

                            {program.participants.length === 0 ? <p style={{ color: 'gray', margin: 0 }}>No participants yet.</p> :
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    {program.participants.map(p => (
                                        <li key={p.participantId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)', padding: '0.5rem 1rem', borderRadius: '4px' }}>
                                            <span>{p.participant.name || 'Unnamed'} ({p.participant.email})</span>
                                            <button onClick={() => handleRemoveParticipant(p.participantId)} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}>Remove</button>
                                        </li>
                                    ))}
                                </ul>
                            }
                        </div>
                    </div>
                )}

                {activeTab === 'events' && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0 }}>Events ({program.events.length})</h3>
                            <button className="glass-button" onClick={() => router.push(`/admin/events/new?programId=${program.id}`)} style={{ padding: '0.5rem 1rem', background: 'rgba(56, 189, 248, 0.2)', borderColor: 'rgba(56, 189, 248, 0.5)' }}>
                                + Schedule Session
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
                                    {program.events.map(ev => (
                                        <tr key={ev.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                            <td style={{ padding: '0.75rem', fontWeight: 500 }}>{ev.name}</td>
                                            <td style={{ padding: '0.75rem', color: 'var(--color-text-muted)' }}>{new Date(ev.start).toLocaleString()}</td>
                                            <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                                <Link href={`/admin/events/${ev.id}`} style={{ color: '#60a5fa', textDecoration: 'none' }}>
                                                    Attendance &rarr;
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                    {program.events.length === 0 && (
                                        <tr>
                                            <td colSpan={3} style={{ padding: '1.5rem', textAlign: 'center', color: 'gray' }}>No events scheduled.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            </div>
        </main>
    );
}
