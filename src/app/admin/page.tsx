"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

export default function AdminDashboardIndex() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const [orphans, setOrphans] = useState<any[]>([]);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            const isAuthorized = (session?.user as any)?.sysadmin || (session?.user as any)?.boardMember;
            if (!isAuthorized) {
                router.push('/');
            }
        }
    }, [status, session, router]);

    useEffect(() => {
        if (status === "authenticated" && ((session?.user as any)?.sysadmin || (session?.user as any)?.boardMember)) {
            fetch('/api/admin/orphans')
                .then(res => res.json())
                .then(data => {
                    if (data.orphans) {
                        setOrphans(data.orphans);
                    }
                })
                .catch(console.error);
        }
    }, [status, session]);

    if (status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading Admin Hub...</h2>
                </div>
            </main>
        );
    }

    if (!session || (!(session.user as any)?.sysadmin && !(session.user as any)?.boardMember)) {
        return null;
    }

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: "800px" }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0 }}>Admin Hub</h1>
                    <button className="glass-button" onClick={() => router.push('/')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Back to Home
                    </button>
                </div>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Welcome to the CheckMeIn Administration Hub. From here you can access operational tools to manage facility events and overrides.
                </p>

                {orphans.length > 0 && (
                    <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.5)', color: '#fca5a5', padding: '1rem', borderRadius: '8px', marginBottom: '2rem', display: 'flex', gap: '12px' }}>
                        <span style={{ fontSize: '1.25rem' }}>🚨</span>
                        <div>
                            <strong>Attention Required:</strong> There are {orphans.length} student(s) registered whose parents have not yet claimed their accounts.
                            <ul style={{ margin: '0.5rem 0 0 0', paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                                {orphans.map(o => (
                                    <li key={o.id}>{o.name || o.email || `Student ID ${o.id}`}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                )}

                <div className={styles.actionGrid}>
                    <button
                        className="glass-button"
                        onClick={() => router.push('/admin/events/visits')}
                        style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)', padding: '2rem', fontSize: '1.25rem', flexDirection: 'column' }}
                    >
                        <strong>Manage Historical Visits</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--color-text)' }}>View and edit past check-in/out records.</p>
                    </button>

                    <button
                        className="glass-button"
                        onClick={() => router.push('/admin/events/badges')}
                        style={{ background: 'rgba(168, 85, 247, 0.2)', borderColor: 'rgba(168, 85, 247, 0.4)', padding: '2rem', fontSize: '1.25rem', flexDirection: 'column' }}
                    >
                        <strong>Raw Badge Events</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--color-text)' }}>Audit real-time RFID tap events across the facility.</p>
                    </button>

                    <button
                        className="glass-button"
                        onClick={() => router.push('/admin/households')}
                        style={{ background: 'rgba(236, 72, 153, 0.2)', borderColor: 'rgba(236, 72, 153, 0.4)', padding: '2rem', fontSize: '1.25rem', flexDirection: 'column' }}
                    >
                        <strong>Manage Memberships</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--color-text)' }}>Grant or revoke official facility memberships for households.</p>
                    </button>

                    <button
                        className="glass-button"
                        onClick={() => router.push('/admin/roles')}
                        style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)', padding: '2rem', fontSize: '1.25rem', flexDirection: 'column' }}
                    >
                        <strong>Role Assignment</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--color-text)' }}>Grant or revoke participant privileges and access levels.</p>
                    </button>

                    <button
                        className="glass-button"
                        onClick={() => router.push('/admin/print-badges')}
                        style={{ background: 'rgba(56, 189, 248, 0.2)', borderColor: 'rgba(56, 189, 248, 0.4)', padding: '2rem', fontSize: '1.25rem', flexDirection: 'column' }}
                    >
                        <strong>Print Badges</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--color-text)' }}>Bulk print standard Avery 5390 ID badges for members.</p>
                    </button>

                    <button
                        className="glass-button"
                        onClick={() => router.push('/admin/participants/new')}
                        style={{ background: 'rgba(245, 158, 11, 0.2)', borderColor: 'rgba(245, 158, 11, 0.4)', padding: '2rem', fontSize: '1.25rem', gridColumn: '1 / -1', flexDirection: 'column' }}
                    >
                        <strong>Create Participant</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.9rem', color: 'var(--color-text)' }}>Manually register a new user in the system before their first login.</p>
                    </button>
                </div>
            </div>
        </main>
    );
}
