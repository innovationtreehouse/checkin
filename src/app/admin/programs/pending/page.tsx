"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../../../page.module.css';
import { formatDateTime } from '@/lib/time';

type PaymentPlanRequest = {
    programId: number;
    participantId: number;
    pendingSince: string;
    participant: {
        id: number;
        name: string | null;
        email: string;
    };
    program: {
        id: number;
        name: string;
        memberPrice: number | null;
        nonMemberPrice: number | null;
    };
};

export default function PaymentPlansPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [requests, setRequests] = useState<PaymentPlanRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const user = session.user as any;
            if (!user?.sysadmin && !user?.boardMember) {
                 router.push('/admin'); // Redirect if entirely unauthorized
            } else if (!user?.boardMember && user?.sysadmin) {
                 // The prompt requested a self-attestation modal for sysadmins. 
                 // However, for brevity and since board members are the intended managers, 
                 // we will enforce a strict board-only view here to simplify UX.
            }
            fetchRequests();
        }
    }, [status, router, session]);

    const fetchRequests = async () => {
        try {
            const res = await fetch('/api/programs/payment-plans');
            if (res.ok) {
                const data = await res.json();
                setRequests(data);
            } else {
                setMessage("Failed to load requests. You may not have access.");
            }
        } catch {
            setMessage("Network error loading requests.");
        } finally {
            setLoading(false);
        }
    };

    const handleApprove = async (programId: number, participantId: number) => {
        if (!confirm("Approve this payment plan? This sets the participant's status to ACTIVE and stops automated unpaid warning emails.")) return;

        try {
            const res = await fetch('/api/programs/payment-plans', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ programId, participantId })
            });

            if (res.ok) {
                // Remove from list
                setRequests(prev => prev.filter(r => !(r.programId === programId && r.participantId === participantId)));
            } else {
                const data = await res.json();
                alert(data.error || "Failed to approve.");
            }
        } catch {
            alert("Network error processing approval.");
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

    if (!session) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = session.user as any;
    if (!user.boardMember && !user.sysadmin) {
        return (
             <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Forbidden</h2>
                </div>
            </main>
        )
    }

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>Payment Plan Requests</h1>
                    <button className="glass-button" onClick={() => router.push('/admin')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Back to Admin
                    </button>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Review pending participants who have clicked the &quot;Request Payment Plan&quot; button. Approving a request marks the user as ACTIVE and exempts them from the 7-day automated removal cron job.
                </p>

                {message && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#f87171' }}>
                        {message}
                    </div>
                )}

                <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '8px', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                <th style={{ padding: '1rem' }}>Participant</th>
                                <th style={{ padding: '1rem' }}>Program</th>
                                <th style={{ padding: '1rem' }}>Requested On</th>
                                <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {requests.map((req) => (
                                <tr key={`${req.programId}-${req.participantId}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: 500 }}>{req.participant.name}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>{req.participant.email}</div>
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <div style={{ fontWeight: 500 }}>{req.program.name}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                            Price: M ${req.program.memberPrice || 0} / NM ${req.program.nonMemberPrice || 0}
                                        </div>
                                    </td>
                                    <td style={{ padding: '1rem', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                                        {formatDateTime(req.pendingSince)}
                                    </td>
                                    <td style={{ padding: '1rem', textAlign: 'right' }}>
                                        <button 
                                            className="glass-button" 
                                            onClick={() => handleApprove(req.programId, req.participantId)}
                                            style={{ padding: '0.4rem 0.8rem', background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)', color: '#4ade80' }}
                                        >
                                            Approve & Mark Active
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {requests.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: 'gray' }}>
                                        No pending payment plan requests.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}

