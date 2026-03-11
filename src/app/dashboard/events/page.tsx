"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../../page.module.css';
import { formatDateTime } from '@/lib/time';

type EventData = {
    id: number;
    name: string;
    description: string | null;
    start: string;
    end: string;
    program: { name: string } | null;
    rsvps: { status: "ATTENDING" | "NOT_ATTENDING" | "MAYBE" }[];
};

export default function ParticipantEventsDashboard() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [events, setEvents] = useState<EventData[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            fetchEvents();
        }
    }, [status]);

    const fetchEvents = async () => {
        try {
            const res = await fetch('/api/events/mine');
            if (res.ok) {
                setEvents(await res.json());
            } else {
                setMessage("Failed to load your events.");
            }
        } catch (error) {
            setMessage("Network error.");
        } finally {
            setLoading(false);
        }
    };

    const handleRSVP = async (eventId: number, newStatus: string) => {
        // Optimistic update
        setEvents(prev => prev.map(ev => {
            if (ev.id === eventId) {
                return {
                    ...ev,
                    rsvps: [{ status: newStatus as any }]
                };
            }
            return ev;
        }));

        try {
            await fetch(`/api/events/${eventId}/rsvp`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
        } catch (error) {
            // Revert on failure by refetching
            fetchEvents();
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

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0, fontSize: '2.5rem' }}>My Upcoming Events</h1>
                    <Link href="/dashboard" className="glass-button" style={{ textDecoration: 'none' }}>
                        &larr; Back to Dashboard
                    </Link>
                </div>

                {message && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#ef4444' }}>
                        {message}
                    </div>
                )}

                {events.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '3rem', background: 'rgba(0,0,0,0.2)', borderRadius: '8px' }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>No Upcoming Events</h3>
                        <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>You have no scheduled events for the programs you are enrolled in.</p>
                        <div style={{ marginTop: '2rem' }}>
                            <Link href="/programs" className="glass-button" style={{ textDecoration: 'none' }}>
                                Browse Programs
                            </Link>
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                        {events.map(ev => {
                            const userRSVP = ev.rsvps.length > 0 ? ev.rsvps[0].status : null;
                            const startStr = formatDateTime(ev.start, { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

                            return (
                                <div key={ev.id} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid rgba(255,255,255,0.1)' }}>
                                    <div>
                                        {ev.program && <div style={{ fontSize: '0.85rem', color: '#38bdf8', marginBottom: '0.25rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{ev.program.name}</div>}
                                        <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '1.25rem' }}>{ev.name}</h3>
                                        <div style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span>&#128197;</span> {startStr}
                                        </div>
                                    </div>

                                    {ev.description && (
                                        <p style={{ margin: 0, fontSize: '0.9rem', color: '#ccc', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                            {ev.description}
                                        </p>
                                    )}

                                    <div style={{ marginTop: 'auto', paddingTop: '1rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                        <div style={{ fontSize: '0.85rem', marginBottom: '0.5rem', color: 'gray' }}>RSVP Status:</div>
                                        <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(0,0,0,0.3)', padding: '0.25rem', borderRadius: '8px' }}>
                                            <button
                                                onClick={() => handleRSVP(ev.id, 'ATTENDING')}
                                                style={{ flex: 1, border: 'none', background: userRSVP === 'ATTENDING' ? '#4ade80' : 'transparent', color: userRSVP === 'ATTENDING' ? '#000' : 'white', padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s' }}
                                            >Yes</button>
                                            <button
                                                onClick={() => handleRSVP(ev.id, 'MAYBE')}
                                                style={{ flex: 1, border: 'none', background: userRSVP === 'MAYBE' ? '#fbbf24' : 'transparent', color: userRSVP === 'MAYBE' ? '#000' : 'white', padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s' }}
                                            >Maybe</button>
                                            <button
                                                onClick={() => handleRSVP(ev.id, 'NOT_ATTENDING')}
                                                style={{ flex: 1, border: 'none', background: userRSVP === 'NOT_ATTENDING' ? '#ef4444' : 'transparent', color: userRSVP === 'NOT_ATTENDING' ? '#fff' : 'white', padding: '0.5rem', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, transition: 'all 0.2s' }}
                                            >No</button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </main>
    );
}
