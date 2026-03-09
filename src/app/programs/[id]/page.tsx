"use client";

import { use, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../../page.module.css';
import { formatDate } from '@/lib/time';

type ProgramDetail = {
    id: number;
    name: string;
    begin: string | null;
    end: string | null;
    leadMentorId: number | null;
    leadMentor?: { name: string | null; email: string } | null;
    participants: { participantId: number }[];
    enrollmentStatus: string;
};

export default function ProgramEnrollmentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session, status } = useSession();
    const router = useRouter();

    const [program, setProgram] = useState<ProgramDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState(false);
    const [message, setMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [requiresOverride, setRequiresOverride] = useState(false);

    useEffect(() => {
        fetchProgram();
    }, [id]);

    const fetchProgram = async () => {
        try {
            const res = await fetch(`/api/programs/${id}`);
            if (res.ok) {
                const data = await res.json();
                setProgram(data);
            } else if (res.status === 404) {
                setMessage("Program not found.");
            } else {
                setMessage("Failed to load program details.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setLoading(false);
        }
    };

    const handleEnroll = async (override = false) => {
        if (!session) {
            // Can't enroll without auth, redirect to login/home
            router.push('/');
            return;
        }

        setEnrolling(true);
        setMessage("");

        try {
            const currentUserId = (session.user as { id: number }).id;
            const res = await fetch(`/api/programs/${id}/participants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantId: currentUserId,
                    override
                })
            });

            if (res.ok) {
                setSuccessMessage("Successfully enrolled!");
                setRequiresOverride(false);
                fetchProgram(); // refresh
            } else {
                const data = await res.json();
                if (data.requiresOverride) {
                    setRequiresOverride(true);
                    setMessage(data.error);
                } else {
                    setMessage(data.error || "Failed to enroll in program.");
                }
            }
        } catch {
            setMessage("Network error during enrollment.");
        } finally {
            setEnrolling(false);
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

    if (!program) return (
        <main className={styles.main}>
            <div className="glass-container animate-float">
                <h2>{message || "Not Found"}</h2>
                <button className="glass-button" onClick={() => router.push('/programs')}>Back to Directory</button>
            </div>
        </main>
    );

    const isEnrolled = session && program.participants.some(p => p.participantId === (session.user as { id: number })?.id);

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '800px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>{program.name}</h1>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        {(session && ((session.user as { sysadmin?: boolean, boardMember?: boolean, id: number })?.sysadmin || (session.user as { sysadmin?: boolean, boardMember?: boolean, id: number })?.boardMember || (session.user as { sysadmin?: boolean, boardMember?: boolean, id: number })?.id === program.leadMentorId)) && (
                            <button className="glass-button" onClick={() => router.push(`/admin/programs/${program.id}`)} style={{ padding: '0.5rem 1rem', background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)', color: '#4ade80' }}>
                                Manage Program
                            </button>
                        )}
                        <button className="glass-button" onClick={() => router.push('/programs')} style={{ padding: '0.5rem 1rem' }}>
                            &larr; Back
                        </button>
                    </div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
                    <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-muted)' }}>Details</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '1.1rem' }}>
                        {program.leadMentor && (
                            <div>
                                <strong>Lead Mentor:</strong> {program.leadMentor.name || 'Unnamed'}
                            </div>
                        )}
                        <div>
                            <strong>Starts:</strong> {program.begin ? formatDate(program.begin) : 'TBD'} <br /><br />
                            <strong>Ends:</strong> {program.end ? formatDate(program.end) : 'Ongoing'}
                        </div>
                        <div>
                            <strong>Enrollment:</strong> {
                                program.enrollmentStatus === 'OPEN' ? <span style={{ color: '#4ade80' }}>Open</span> :
                                program.enrollmentStatus === 'CLOSED' ? <span style={{ color: '#f87171' }}>Closed</span> :
                                program.enrollmentStatus === 'WHITELIST' ? <span style={{ color: '#eab308' }}>Invite Only</span> :
                                program.enrollmentStatus
                            }
                        </div>
                    </div>
                </div>

                {message && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#f87171' }}>
                        {message}
                    </div>
                )}

                {successMessage && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', color: '#4ade80' }}>
                        {successMessage}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '3rem' }}>
                    {isEnrolled ? (
                        <div style={{ padding: '1rem 2rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.5)', borderRadius: '8px', color: '#4ade80', fontWeight: 'bold' }}>
                            You are enrolled in this program.
                        </div>
                    ) : (
                        <>
                            <button
                                className="glass-button primary-button"
                                onClick={() => handleEnroll(false)}
                                disabled={enrolling || program.enrollmentStatus === 'CLOSED'}
                                style={{ 
                                    padding: '1rem 3rem', 
                                    fontSize: '1.2rem', 
                                    background: program.enrollmentStatus === 'CLOSED' ? 'rgba(56, 189, 248, 0.05)' : 'rgba(56, 189, 248, 0.2)', 
                                    borderColor: program.enrollmentStatus === 'CLOSED' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(56, 189, 248, 0.5)',
                                    opacity: program.enrollmentStatus === 'CLOSED' ? 0.5 : 1,
                                    cursor: program.enrollmentStatus === 'CLOSED' ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {enrolling ? "Enrolling..." : program.enrollmentStatus === 'CLOSED' ? "Enrollment Closed" : "Enroll Now"}
                            </button>
                            {requiresOverride && (
                                <div style={{ marginTop: '1.5rem', padding: '1.5rem', borderRadius: '8px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                                    <p style={{ color: '#eab308', fontWeight: 'bold', marginBottom: '1rem' }}>Warning: Enrollment rules not met.</p>
                                    <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                                        As an Admin or Lead Mentor, you can bypass this restriction. Are you sure you want to force enroll?
                                    </p>
                                    <button
                                        className="glass-button"
                                        onClick={() => handleEnroll(true)}
                                        style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#eab308', borderColor: 'rgba(234, 179, 8, 0.5)' }}
                                    >
                                        Force Enroll (Override)
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>
        </main>
    );
}
