"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '@/app/page.module.css';
import { formatDateTime } from '@/lib/time';

export default function AdminVisitsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [visits, setVisits] = useState<any[]>([]);
    const [message, setMessage] = useState("");

    const [editingVisitId, setEditingVisitId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({ arrived: "", departed: "" });

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            if (!(session.user as any)?.sysadmin) {
                router.push('/');
            } else {
                fetchVisits();
            }
        }
    }, [status, session, router]);

    const fetchVisits = async () => {
        try {
            const res = await fetch('/api/admin/visits');
            if (res.ok) {
                const data = await res.json();
                setVisits(data.visits);
            } else {
                setMessage("Failed to load visits.");
            }
        } catch (error) {
            setMessage("Network error loading visits.");
        } finally {
            setLoading(false);
        }
    };

    const handleEditClick = (visit: any) => {
        const confirmEdit = window.confirm("Warning: You are editing a past visit record using Admin overrides. This will be permanently logged.");
        if (!confirmEdit) return;

        setEditingVisitId(visit.id);
        const formatForInput = (dateString: string | null) => {
            if (!dateString) return "";
            const d = new Date(dateString);
            return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        };
        setEditForm({
            arrived: formatForInput(visit.arrived),
            departed: formatForInput(visit.departed)
        });
    };

    const handleSaveEdit = async (id: number) => {
        try {
            const res = await fetch(`/api/admin/visits`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    visitId: id,
                    arrived: editForm.arrived ? new Date(editForm.arrived).toISOString() : undefined,
                    departed: editForm.departed ? new Date(editForm.departed).toISOString() : undefined
                })
            });
            if (res.ok) {
                setMessage("Visit updated successfully.");
                setEditingVisitId(null);
                fetchVisits();
            } else {
                setMessage("Failed to update visit.");
            }
        } catch (error) {
            setMessage("Network error saving visit.");
        }
    };

    if (loading || status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading Admin Data...</h2>
                </div>
            </main>
        );
    }

    if (!session || !(session.user as any)?.sysadmin) return null;

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '1000px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>Visit History</h1>
                    <button className="glass-button" onClick={() => router.push('/admin')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Admin Ops
                    </button>
                </div>

                {message && (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: message.includes('success') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${message.includes('success') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        borderRadius: '8px',
                        color: message.includes('success') ? '#4ade80' : '#f87171',
                    }}>
                        {message}
                    </div>
                )}

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>ID</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Participant</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Event</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Arrived</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Departed</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visits.map(v => (
                                <tr key={v.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '0.75rem' }}>{v.id}</td>
                                    <td style={{ padding: '0.75rem' }}>{v.participant?.email}</td>
                                    <td style={{ padding: '0.75rem' }}>{v.event?.name || 'Open Facility'}</td>

                                    {editingVisitId === v.id ? (
                                        <>
                                            <td style={{ padding: '0.75rem' }}>
                                                <input
                                                    type="datetime-local"
                                                    className="glass-input"
                                                    value={editForm.arrived}
                                                    onChange={e => setEditForm({ ...editForm, arrived: e.target.value })}
                                                    style={{ padding: '0.2rem 0.5rem' }}
                                                />
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <input
                                                    type="datetime-local"
                                                    className="glass-input"
                                                    value={editForm.departed}
                                                    onChange={e => setEditForm({ ...editForm, departed: e.target.value })}
                                                    style={{ padding: '0.2rem 0.5rem' }}
                                                />
                                            </td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <button onClick={() => handleSaveEdit(v.id)} style={{ background: '#4ade80', color: 'black', border: 'none', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer', marginRight: '0.5rem' }}>Save</button>
                                                <button onClick={() => setEditingVisitId(null)} style={{ background: 'transparent', color: 'white', border: '1px solid white', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer' }}>Cancel</button>
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td style={{ padding: '0.75rem' }}>{formatDateTime(v.arrived)}</td>
                                            <td style={{ padding: '0.75rem' }}>{v.departed ? formatDateTime(v.departed) : <span style={{ color: '#fbbf24' }}>Active</span>}</td>
                                            <td style={{ padding: '0.75rem' }}>
                                                <button
                                                    onClick={() => handleEditClick(v)}
                                                    style={{ background: 'rgba(59, 130, 246, 0.2)', border: '1px solid rgba(59, 130, 246, 0.4)', color: 'white', padding: '0.25rem 0.5rem', borderRadius: '4px', cursor: 'pointer' }}
                                                >
                                                    Edit
                                                </button>
                                            </td>
                                        </>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}
