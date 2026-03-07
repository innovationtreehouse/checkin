"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '@/app/page.module.css';
import { formatDateTime } from '@/lib/time';

export default function AdminBadgesPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [badges, setBadges] = useState<any[]>([]);
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            if (!(session.user as any)?.sysadmin) {
                router.push('/');
            } else {
                fetchBadges();
            }
        }
    }, [status, session, router]);

    const fetchBadges = async () => {
        try {
            const res = await fetch('/api/admin/badges');
            if (res.ok) {
                const data = await res.json();
                setBadges(data.badges);
            } else {
                setMessage("Failed to load badge events.");
            }
        } catch (error) {
            setMessage("Network error loading badges.");
        } finally {
            setLoading(false);
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
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>Raw Badge Events</h1>
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
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Time</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Participant</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Email</th>
                                <th style={{ padding: '0.75rem', color: 'var(--color-primary)' }}>Location</th>
                            </tr>
                        </thead>
                        <tbody>
                            {badges.map(b => (
                                <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '0.75rem' }}>{b.id}</td>
                                    <td style={{ padding: '0.75rem' }}>{formatDateTime(b.time)}</td>
                                    <td style={{ padding: '0.75rem' }}>{b.participant?.name || "Unknown"}</td>
                                    <td style={{ padding: '0.75rem' }}>{b.participant?.email}</td>
                                    <td style={{ padding: '0.75rem' }}>{b.location || 'Front Door'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}
