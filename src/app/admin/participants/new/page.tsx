"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

import { useState, useEffect, Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import styles from '../../../page.module.css';

type HouseholdOption = {
    id: number;
    name: string;
    participants: { id: number; name: string | null; email: string | null }[];
};

export default function NewParticipantPage() {
    return (
        <Suspense fallback={<main className={styles.main}><div className="glass-container animate-float">Loading...</div></main>}>
            <NewParticipantForm />
        </Suspense>
    );
}

function NewParticipantForm() {
    const { data: session, status } = useSession();
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryHouseholdId = searchParams.get('householdId');

    const [name, setName] = useState("");
    const [email, setEmail] = useState("");
    const [parentEmail, setParentEmail] = useState("");
    const [dob, setDob] = useState("");

    // Household search state
    const [householdId, setHouseholdId] = useState("");
    const [householdSearch, setHouseholdSearch] = useState("");
    const [householdResults, setHouseholdResults] = useState<HouseholdOption[]>([]);
    const [householdSearching, setHouseholdSearching] = useState(false);

    const isStudent = () => {
        if (!dob) return false;
        const birthDate = new Date(dob);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }
        return age < 18;
    };

    const studentSelected = isStudent();

    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);

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

    // Handle deep linked household
    useEffect(() => {
        if (queryHouseholdId && !householdId) {
            const fetchHousehold = async () => {
                try {
                    const res = await fetch(`/api/admin/households?id=${queryHouseholdId}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.household) {
                            setHouseholdId(data.household.id.toString());
                            setHouseholdSearch(data.household.name || `Household #${data.household.id}`);
                        }
                    }
                } catch (err) {
                    console.error("Failed to fetch deep linked household:", err);
                }
            };
            fetchHousehold();
        }
    }, [queryHouseholdId, householdId]);

    // Debounced household search
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (householdSearch && !householdId) {
                const search = async () => {
                    setHouseholdSearching(true);
                    try {
                        const res = await fetch(`/api/admin/households?q=${encodeURIComponent(householdSearch)}`);
                        if (res.ok) {
                            const data = await res.json();
                            setHouseholdResults(data.households || []);
                        }
                    } finally {
                        setHouseholdSearching(false);
                    }
                };
                search();
            } else if (!householdSearch) {
                setHouseholdResults([]);
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [householdSearch, householdId]);

    if (status === "loading") {
        return <main className={styles.main}><div className="glass-container animate-float">Loading...</div></main>;
    }

    if (!session || (!(session.user as any)?.sysadmin && !(session.user as any)?.boardMember)) {
        return null;
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage("");
        setIsError(false);

        try {
            const res = await fetch('/api/admin/participants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    email: email || null,
                    parentEmail: studentSelected ? parentEmail : null,
                    dob: dob || null,
                    householdId: householdId ? parseInt(householdId) : null
                })
            });

            const data = await res.json();

            if (res.ok) {
                setMessage(`Participant ${name || data.participant.email || 'created'} successfully!`);
                setName("");
                setEmail("");
                setParentEmail("");
                setDob("");
                setHouseholdId("");
                setHouseholdSearch("");
            } else {
                setIsError(true);
                setMessage(data.error || "Failed to create participant");
            }
        } catch (error) {
            setIsError(true);
            setMessage("Network error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '800px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0 }}>Register New User</h1>
                    <Link href="/admin" style={{ color: 'white', textDecoration: 'none' }} className="glass-button">
                        &larr; Admin Hub
                    </Link>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    System Administrators can manually register a new participant into the database. When they log in via their Google email for the first time, their account will instantly link to this profile.
                </p>

                {message && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)', border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`, borderRadius: '8px', color: isError ? '#ef4444' : '#4ade80' }}>
                        {message}
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Full Name</label>
                            <input type="text" className="glass-input" value={name} onChange={e => setName(e.target.value)} style={{ width: '100%', padding: '0.75rem' }} placeholder="e.g. Jane Doe" />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Date of Birth {studentSelected && <span style={{ color: '#c084fc', marginLeft: '8px', fontSize: '0.8rem' }}>(Student Detected)</span>}</label>
                            <input type="date" className="glass-input" value={dob} onChange={e => setDob(e.target.value)} style={{ width: '100%', padding: '0.75rem', maxWidth: '300px' }} />
                        </div>

                        <div>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Participant Google Email {studentSelected ? "(Optional for Students)" : "*"}</label>
                            <input type="email" className="glass-input" value={email} onChange={e => setEmail(e.target.value)} required={!studentSelected && !householdId} style={{ width: '100%', padding: '0.75rem' }} placeholder="jane.doe@example.com" />
                        </div>

                        {studentSelected && (
                            <div style={{ background: 'rgba(168, 85, 247, 0.1)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(168, 85, 247, 0.3)' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Parent / Guardian Google Email {!householdId ? '*' : '(Optional)'}</label>
                                <p style={{ fontSize: '0.85rem', color: 'gray', marginTop: 0, marginBottom: '1rem' }}>Because the participant is under 18, a parent or guardian&apos;s email is required to associate their accounts — unless you assign them to an existing household below.</p>
                                <input type="email" className="glass-input" value={parentEmail} onChange={e => setParentEmail(e.target.value)} required={studentSelected && !householdId} style={{ width: '100%', padding: '0.75rem' }} placeholder="parent@example.com" />
                            </div>
                        )}

                        {/* Household Selector */}
                        <div style={{ position: 'relative', background: 'rgba(59, 130, 246, 0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                            <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                Add to Existing Household (Optional)
                            </label>
                            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '1rem' }}>
                                Search by household name or member name/email. If left blank, a new household will be created automatically for adults.
                            </p>
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    className="glass-input"
                                    value={householdSearch}
                                    onChange={e => { setHouseholdSearch(e.target.value); setHouseholdId(""); }}
                                    style={{ width: '100%', padding: '0.75rem' }}
                                    placeholder="Search households..."
                                />
                                {householdId && (
                                    <button
                                        type="button"
                                        onClick={() => { setHouseholdId(""); setHouseholdSearch(""); }}
                                        style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.5rem', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                            {householdSearching && <div style={{ marginTop: '0.5rem', color: 'gray', fontSize: '0.8rem' }}>Searching...</div>}
                            {householdResults.length > 0 && !householdId && (
                                <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', zIndex: 10, maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', marginTop: '4px' }}>
                                    {householdResults.map(h => (
                                        <div
                                            key={h.id}
                                            onClick={() => {
                                                setHouseholdId(h.id.toString());
                                                setHouseholdSearch(h.name || `Household #${h.id}`);
                                                setHouseholdResults([]);
                                            }}
                                            style={{ padding: '0.75rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <div style={{ fontWeight: 500 }}>{h.name || `Household #${h.id}`}</div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                {h.participants.map(p => p.name || p.email || 'Unnamed').join(', ') || 'Empty'}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button type="submit" className="glass-button" disabled={saving || (!studentSelected && !email && !householdId) || (studentSelected && !parentEmail && !householdId)} style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)', marginTop: '1rem', padding: '1rem', fontSize: '1.1rem' }}>
                            {saving ? "Registering..." : "Create Participant"}
                        </button>
                    </div>
                </form>
            </div>
        </main>
    );
}
