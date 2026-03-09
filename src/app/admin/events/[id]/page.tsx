"use client";

import { useState, useEffect, use, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../../../page.module.css';
import { formatDateTime } from '@/lib/time';

type ParticipantDetail = {
    participantId: number;
    participant: {
        id: number;
        name: string | null;
        email: string;
    };
    isCore?: boolean;
};

type EventData = {
    id: number;
    name: string;
    start: string;
    end: string;
    attendanceConfirmedAt: string | null;
    recurringGroupId: string | null;
    program?: {
        id: number;
        name: string;
        leadMentorId: number | null;
        volunteers: ParticipantDetail[];
        participants: ParticipantDetail[];
    };
    visits: {
        id: number;
        participantId: number;
        arrived: string;
        departed: string | null;
    }[];
};

export default function EventAdminPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session, status } = useSession();
    const router = useRouter();

    const [eventData, setEventData] = useState<EventData | null>(null);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");
    const [actionLoading, setActionLoading] = useState(false);

    // Edit states
    const [editMode, setEditMode] = useState(false);
    const [newStart, setNewStart] = useState("");
    const [newEnd, setNewEnd] = useState("");
    const [applyToFuture, setApplyToFuture] = useState(false);

    const fetchEvent = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`/api/events/${id}`);
            if (res.ok) {
                const data = await res.json();
                setEventData(data);
                
                // Set default form values
                const startStr = new Date(new Date(data.start).getTime() - new Date(data.start).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                const endStr = new Date(new Date(data.end).getTime() - new Date(data.end).getTimezoneOffset() * 60000).toISOString().slice(0, 16);
                setNewStart(startStr);
                setNewEnd(endStr);
            } else {
                setMessage("Failed to load event.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            fetchEvent();
        }
    }, [status, router, id, fetchEvent]);

    const handleConfirmAttendance = async () => {
        setActionLoading(true);
        try {
            const res = await fetch(`/api/events/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'confirmAttendance' })
            });

            if (res.ok) {
                setMessage("Attendance confirmed successfully!");
                fetchEvent();
            } else {
                const data = await res.json();
                setMessage(data.error || "Failed to confirm attendance.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleEditTime = async () => {
        setActionLoading(true);
        try {
            // Need to convert local datetime back to UTC ISO
            const startIso = new Date(newStart).toISOString();
            const endIso = new Date(newEnd).toISOString();
            
            const res = await fetch(`/api/events/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'editTime',
                    start: startIso,
                    end: endIso,
                    applyToFuture
                })
            });

            if (res.ok) {
                setMessage("Event time updated successfully!");
                setEditMode(false);
                fetchEvent();
            } else {
                const data = await res.json();
                setMessage(data.error || "Failed to edit event.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setActionLoading(false);
        }
    };

    const handleCancelEvent = async () => {
        if (!confirm("Are you sure you want to cancel this event? This action cannot be undone.")) return;
        
        setActionLoading(true);
        try {
            const res = await fetch(`/api/events/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    action: 'cancel',
                    applyToFuture
                })
            });

            if (res.ok) {
                router.push(eventData?.program?.id ? `/admin/programs/${eventData.program.id}` : '/admin/programs');
            } else {
                const data = await res.json();
                setMessage(data.error || "Failed to cancel event.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setActionLoading(false);
        }
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

    if (!session || !eventData) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>{message || "Not Found"}</h2>
                    <button className="glass-button" onClick={() => router.back()}>Go Back</button>
                </div>
            </main>
        );
    }

    const user = session?.user as unknown as { id: number; sysadmin?: boolean; boardMember?: boolean };
    const userId = user?.id;
    const isSysAdminOrBoard = user?.sysadmin || user?.boardMember;
    const isLeadMentor = eventData.program?.leadMentorId === userId;
    const isCoreVolunteer = eventData.program?.volunteers.some(v => v.participantId === userId && v.isCore) || false;
    
    // Core volunteers can see attendance tracking but cannot edit/cancel events.
    const canManageAttendance = isSysAdminOrBoard || isLeadMentor || isCoreVolunteer;
    const canManageEventInfo = isSysAdminOrBoard || isLeadMentor;

    const isPastEvent = new Date(eventData.end) < new Date();

    const renderRosterGrid = () => {
        if (!eventData.program) return null;

        const allRoster = [
            ...eventData.program.volunteers.map(v => ({ ...v, role: v.isCore ? 'Core Volunteer' : 'Volunteer' })),
            ...eventData.program.participants.map(p => ({ ...p, role: 'Participant' }))
        ];

        // Sort by role then name
        allRoster.sort((a, b) => {
            if (a.role !== b.role) return a.role.localeCompare(b.role);
            const nameA = a.participant.name || "";
            const nameB = b.participant.name || "";
            return nameA.localeCompare(nameB);
        });

        return (
            <div style={{ overflowX: 'auto', marginTop: '1.5rem', background: 'rgba(0,0,0,0.2)', padding: '1rem', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
                            <th style={{ padding: '0.75rem' }}>Name</th>
                            <th style={{ padding: '0.75rem' }}>Role</th>
                            <th style={{ padding: '0.75rem' }}>Status / Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        {allRoster.map(member => {
                            const visit = eventData.visits.find(v => v.participantId === member.participantId);
                            let statusEl;

                            if (visit) {
                                const arriveTime = new Date(visit.arrived).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                const leaveTime = visit.departed ? new Date(visit.departed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Still Here';
                                statusEl = (
                                    <span style={{ color: '#4ade80' }}>
                                        Arrived: {arriveTime} {visit.departed ? `| Left: ${leaveTime}` : ''}
                                    </span>
                                );
                            } else {
                                statusEl = <span style={{ color: '#f87171' }}>Absent</span>;
                            }

                            return (
                                <tr key={`${member.role}-${member.participantId}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '0.75rem', fontWeight: 500 }}>
                                        {member.participant.name || 'Unnamed'}
                                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{member.participant.email}</div>
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>
                                        <span style={{ 
                                            padding: '0.2rem 0.5rem', 
                                            borderRadius: '4px', 
                                            fontSize: '0.85rem',
                                            background: member.role === 'Participant' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                                            color: member.role === 'Participant' ? '#38bdf8' : '#eab308'
                                        }}>
                                            {member.role}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.75rem' }}>{statusEl}</td>
                                </tr>
                            );
                        })}
                        {allRoster.length === 0 && (
                            <tr>
                                <td colSpan={3} style={{ padding: '1.5rem', textAlign: 'center', color: 'gray' }}>No roster found for this program.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        );
    };

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '900px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: '0 0 0.5rem 0' }}>{eventData.name}</h1>
                        <div style={{ color: 'var(--color-text-muted)', fontSize: '1.1rem' }}>
                            {formatDateTime(eventData.start)} - {formatDateTime(eventData.end)}
                        </div>
                    </div>
                    <button className="glass-button" onClick={() => router.back()} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Go Back
                    </button>
                </div>

                {message && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: '8px', color: '#38bdf8' }}>
                        {message}
                    </div>
                )}

                {/* PAST EVENT: ATTENDANCE CONFIRMATION */}
                {isPastEvent && canManageAttendance && (
                    <div style={{ marginBottom: '2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                            <div>
                                <h3 style={{ margin: '0 0 0.5rem 0' }}>Attendance Tracking</h3>
                                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Review program badge scans below and confirm final attendance.</p>
                            </div>
                            <button
                                className="glass-button"
                                onClick={handleConfirmAttendance}
                                disabled={actionLoading}
                                style={{
                                    padding: '0.75rem 1.5rem',
                                    fontWeight: 'bold',
                                    background: eventData.attendanceConfirmedAt ? 'rgba(148, 163, 184, 0.2)' : 'rgba(234, 179, 8, 0.2)',
                                    borderColor: eventData.attendanceConfirmedAt ? 'rgba(148, 163, 184, 0.5)' : 'rgba(234, 179, 8, 0.5)',
                                    color: eventData.attendanceConfirmedAt ? '#cbd5e1' : '#eab308'
                                }}
                            >
                                {eventData.attendanceConfirmedAt ? `Confirmed on ${new Date(eventData.attendanceConfirmedAt).toLocaleDateString()}` : "Confirm Attendance"}
                            </button>
                        </div>
                        {renderRosterGrid()}
                    </div>
                )}

                {/* FUTURE EVENT: EDIT / CANCEL */}
                {!isPastEvent && canManageEventInfo && (
                    <div style={{ marginBottom: '2rem', background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px' }}>
                        <h3 style={{ margin: '0 0 1.5rem 0' }}>Manage Event</h3>
                        
                        {!editMode ? (
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <button className="glass-button" onClick={() => setEditMode(true)} style={{ background: 'rgba(96, 165, 250, 0.2)', borderColor: 'rgba(96, 165, 250, 0.4)', color: '#60a5fa' }}>
                                    Edit Date / Time
                                </button>
                                <button className="glass-button" onClick={() => setEditMode(true)} style={{ background: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}>
                                    Cancel Event
                                </button>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '8px' }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Start Time</label>
                                        <input type="datetime-local" className="glass-input" value={newStart} onChange={e => setNewStart(e.target.value)} style={{ width: '100%', padding: '0.75rem' }} />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>End Time</label>
                                        <input type="datetime-local" className="glass-input" value={newEnd} onChange={e => setNewEnd(e.target.value)} style={{ width: '100%', padding: '0.75rem' }} />
                                    </div>
                                </div>
                                
                                {eventData.recurringGroupId && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', background: 'rgba(234, 179, 8, 0.1)', padding: '1rem', borderRadius: '4px', border: '1px solid rgba(234, 179, 8, 0.3)', color: '#fde047' }}>
                                        <input type="checkbox" checked={applyToFuture} onChange={e => setApplyToFuture(e.target.checked)} style={{ width: '1.2rem', height: '1.2rem' }} />
                                        <span><strong>Apply to Series:</strong> Apply these changes (time shift or cancellation) to this event and all FUTURE events in this recurring set.</span>
                                    </label>
                                )}

                                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                    <button className="glass-button" onClick={handleEditTime} disabled={actionLoading} style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                                        {actionLoading ? "Saving..." : "Save Time Changes"}
                                    </button>
                                    <button className="glass-button" onClick={handleCancelEvent} disabled={actionLoading} style={{ background: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }}>
                                        {actionLoading ? "Canceling..." : "Cancel Event(s)"}
                                    </button>
                                    <button className="glass-button" onClick={() => setEditMode(false)} disabled={actionLoading} style={{ marginLeft: 'auto' }}>
                                        Nevermind
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {/* Fallback for Core Volunteers on future events */}
                {!isPastEvent && !canManageEventInfo && canManageAttendance && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <p style={{ margin: 0 }}>This is a scheduled future event. Attendance tracking will become available once the event has concluded.</p>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem' }}>Only Program Leads and Administrators can modify or cancel future events.</p>
                    </div>
                )}
                
                {/* If it's a past event but they aren't authorized to manage attendance */}
                {isPastEvent && !canManageAttendance && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        <p style={{ margin: 0 }}>This is a past event. You do not have permission to manage attendance for this program.</p>
                    </div>
                )}
            </div>
        </main>
    );
}
