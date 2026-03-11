"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../../page.module.css';

export default function AdminHouseholdsPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [households, setHouseholds] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            const isAuthorized = (session?.user as any)?.sysadmin || (session?.user as any)?.boardMember;
            if (!isAuthorized) {
                router.push('/');
            } else {
                fetchHouseholds();
            }
        }
    }, [status, session, router]);

    const fetchHouseholds = async () => {
        try {
            const res = await fetch('/api/admin/households');
            if (res.ok) {
                const data = await res.json();
                setHouseholds(data.households);
            } else {
                setError("Failed to fetch households.");
            }
        } catch {
            setError("Network error.");
        } finally {
            setLoading(false);
        }
    };

    const toggleMembership = async (householdId: number, currentActive: boolean) => {
        try {
            const res = await fetch('/api/admin/households', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ householdId, active: !currentActive })
            });

            if (res.ok) {
                // Refresh list
                fetchHouseholds();
            } else {
                alert("Failed to update membership.");
            }
        } catch {
            alert("Network error.");
        }
    };

    if (loading || status === "loading") {
        return <main className={styles.main}><div className="glass-container animate-float">Loading...</div></main>;
    }

    if (!session || (!(session.user as any)?.sysadmin && !(session.user as any)?.boardMember)) {
        return null;
    }

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0 }}>Manage Memberships</h1>
                    <Link href="/admin" style={{ color: 'white', textDecoration: 'none' }} className="glass-button">
                        &larr; Admin Hub
                    </Link>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    View all households and toggle their official facility Membership status. Memberships grant shop access and other organizational privileges.
                </p>

                {error && <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{error}</div>}

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>Household</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>Participants</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>Is Member?</th>
                                <th style={{ padding: '1rem', color: 'var(--color-text-muted)' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {households.map((household) => {
                                const hasActiveMembership = household.memberships?.some((m: any) => m.active);

                                return (
                                    <tr key={household.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '1rem' }}>
                                            <strong>{household.name || `Household #${household.id}`}</strong>
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            <ul style={{ margin: 0, paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
                                                {household.participants?.map((p: any) => (
                                                    <li key={p.id}>{p.name || p.email}</li>
                                                ))}
                                            </ul>
                                            {(!household.participants || household.participants.length === 0) && (
                                                <span style={{ color: 'gray', fontStyle: 'italic', fontSize: '0.9rem' }}>Empty</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem' }}>
                                            {hasActiveMembership ? (
                                                <span style={{ color: '#4ade80', fontWeight: 'bold' }}>Yes</span>
                                            ) : (
                                                <span style={{ color: 'gray' }}>No</span>
                                            )}
                                        </td>
                                        <td style={{ padding: '1rem', display: 'flex', gap: '0.5rem' }}>
                                            <button
                                                className="glass-button"
                                                onClick={() => router.push(`/admin/participants/new?householdId=${household.id}`)}
                                                style={{
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.9rem',
                                                    background: 'rgba(59, 130, 246, 0.2)',
                                                    borderColor: 'rgba(59, 130, 246, 0.4)',
                                                }}
                                            >
                                                + Add Participant
                                            </button>
                                            <button
                                                className="glass-button"
                                                onClick={() => toggleMembership(household.id, hasActiveMembership)}
                                                style={{
                                                    padding: '0.5rem 1rem',
                                                    fontSize: '0.9rem',
                                                    background: hasActiveMembership ? 'rgba(239, 68, 68, 0.2)' : 'rgba(34, 197, 94, 0.2)',
                                                    borderColor: hasActiveMembership ? 'rgba(239, 68, 68, 0.4)' : 'rgba(34, 197, 94, 0.4)',
                                                }}
                                            >
                                                {hasActiveMembership ? "Revoke Membership" : "Grant Membership"}
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}

                            {households.length === 0 && (
                                <tr>
                                    <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>No households found.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

            </div>
        </main>
    );
}
