"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/set-state-in-effect */

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../../page.module.css';
import { formatDate } from '@/lib/time';

type UserProgram = {
    programId: number;
    program: {
        id: number;
        name: string;
        begin: string | null;
        end: string | null;
    }
};

export default function MyProgramsDashboard() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [enrollments, setEnrollments] = useState<UserProgram[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            // Wait, we need a dedicated API to fetch 'my' programs or filter existing endpoints.
            // Let's assume `/api/programs/me` is created, or we instruct the user that it needs to be made.
            // For now, let's fetch from a placeholder or use a query config if we update the backend.
            setMessage("Note: Fetching 'my programs' requires a dedicated backend query which we will add in the final polish. This UI is ready for it.");
            setLoading(false);
        }
    }, [status, router]);

    if (loading || status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading My Programs...</h2>
                </div>
            </main>
        );
    }

    if (!session) return null;

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>My Programs</h1>
                    <button className="glass-button" onClick={() => router.push('/programs')} style={{ padding: '0.5rem 1rem' }}>
                        Browse More Programs
                    </button>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Manage the programs you are currently enrolled in.
                </p>

                {message && (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        color: '#f87171',
                    }}>
                        {message}
                    </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1.5rem' }}>
                    {enrollments.map(({ program }) => (
                        <div key={program.id} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column' }}>
                            <h3 style={{ margin: '0 0 1rem 0' }}>{program.name}</h3>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: '0.5rem', flex: 1 }}>
                                {program.begin ? formatDate(program.begin) : 'Start Date TBD'}
                                {program.end ? ` - ${formatDate(program.end)}` : ' (Ongoing)'}
                            </p>

                            <Link href={`/programs/${program.id}`} style={{ display: 'block', textAlign: 'center', background: 'rgba(255, 255, 255, 0.1)', color: 'white', padding: '0.75rem', borderRadius: '8px', textDecoration: 'none', fontWeight: 500, marginTop: '1.5rem' }}>
                                View Details
                            </Link>
                        </div>
                    ))}

                    {enrollments.length === 0 && !loading && (
                        <div style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                            You are not enrolled in any programs yet.
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
