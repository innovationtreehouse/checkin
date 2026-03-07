"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import styles from '../page.module.css';
import { formatDate } from '@/lib/time';

type ProgramSummary = {
    id: number;
    name: string;
    begin: string | null;
    end: string | null;
    memberOnly: boolean;
    phase: string;
    enrollmentStatus: string;
    leadMentorId: number | null;
    _count: {
        participants: number;
        volunteers: number;
        events: number;
    };
};

export default function PublicProgramsDirectory() {
    const { data: session, status } = useSession();
    const [programs, setPrograms] = useState<ProgramSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");
    const [activeOnly, setActiveOnly] = useState(true);

    const isAuthorized = session && ((session.user as any)?.sysadmin || (session.user as any)?.boardMember);

    useEffect(() => {
        const fetchPrograms = async () => {
            setLoading(true);
            try {
                const query = (isAuthorized && !activeOnly) ? '' : '?active=true';
                const res = await fetch(`/api/programs${query}`);
                if (res.ok) {
                    const data = await res.json();
                    setPrograms(data);
                } else {
                    setMessage("Failed to load program directory.");
                }
            } catch (error) {
                setMessage("Network error loading programs.");
            } finally {
                setLoading(false);
            }
        };

        fetchPrograms();
    }, [activeOnly, isAuthorized]);

    if (loading) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading Programs...</h2>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>Programs Directory</h1>
                        <p style={{ color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                            Discover courses, certifications, and group activities at the Treehouse.
                        </p>
                    </div>
                    {isAuthorized && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', color: 'var(--color-text-muted)' }}>
                                <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }} />
                                Show active only
                            </label>
                            <Link href="/admin/programs/new" style={{ padding: '0.6rem 1.2rem', background: 'rgba(34, 197, 94, 0.2)', border: '1px solid rgba(34, 197, 94, 0.4)', borderRadius: '8px', color: '#4ade80', textDecoration: 'none', fontWeight: 500 }}>
                                + New Program
                            </Link>
                        </div>
                    )}
                </div>

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
                    {programs.map(program => (
                        <div key={program.id} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '12px', padding: '1.5rem', border: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexDirection: 'column' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                                <h3 style={{ margin: 0 }}>{program.name}</h3>
                                {program.memberOnly && (
                                    <span style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#d8b4fe', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, border: '1px solid rgba(168, 85, 247, 0.4)' }}>
                                        Member Only
                                    </span>
                                )}
                                {program.enrollmentStatus === 'CLOSED' && (
                                    <span style={{ background: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5', padding: '0.2rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, border: '1px solid rgba(239, 68, 68, 0.4)', marginLeft: '0.5rem' }}>
                                        Enrollment Closed
                                    </span>
                                )}
                            </div>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', flex: 1 }}>
                                {program.begin ? formatDate(program.begin) : 'Start Date TBD'}
                                {program.end ? ` - ${formatDate(program.end)}` : ' (Ongoing)'}
                            </p>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.1)', padding: '0.75rem', borderRadius: '8px', fontSize: '0.85rem' }}>
                                <div style={{ textAlign: 'center', flex: 1 }}>
                                    <strong style={{ color: 'white', fontSize: '1rem' }}>{program._count.participants}</strong>
                                    <div style={{ color: 'var(--color-text-muted)' }}>Enrolled</div>
                                </div>
                                <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', alignSelf: 'stretch', margin: '0 0.5rem' }}></div>
                                <div style={{ textAlign: 'center', flex: 1 }}>
                                    <strong style={{ color: 'white', fontSize: '1rem' }}>{program._count.volunteers}</strong>
                                    <div style={{ color: 'var(--color-text-muted)' }}>Volunteers</div>
                                </div>
                                <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', alignSelf: 'stretch', margin: '0 0.5rem' }}></div>
                                <div style={{ textAlign: 'center', flex: 1 }}>
                                    <strong style={{ color: 'white', fontSize: '1rem' }}>{program._count.events}</strong>
                                    <div style={{ color: 'var(--color-text-muted)' }}>Sessions</div>
                                </div>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem' }}>
                                <Link href={`/programs/${program.id}`} style={{ flex: 1, display: 'block', textAlign: 'center', background: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '0.75rem', borderRadius: '8px', textDecoration: 'none', fontWeight: 500 }}>
                                    View Details
                                </Link>
                                {(session && ((session.user as any)?.sysadmin || (session.user as any)?.boardMember || (session.user as any)?.id === program.leadMentorId)) && (
                                    <Link href={`/admin/programs/${program.id}`} style={{ flex: 1, display: 'block', textAlign: 'center', background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', padding: '0.75rem', borderRadius: '8px', textDecoration: 'none', fontWeight: 500 }}>
                                        Manage
                                    </Link>
                                )}
                            </div>
                        </div>
                    ))}

                    {programs.length === 0 && !loading && (
                        <div style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', color: 'var(--color-text-muted)', background: 'rgba(0,0,0,0.2)', borderRadius: '12px' }}>
                            No active programs currently available. Check back soon!
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
