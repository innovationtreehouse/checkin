"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../../../page.module.css';

type ParticipantOption = {
    id: number;
    name: string | null;
    email: string;
};

export default function CreateProgramPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [name, setName] = useState("");
    const [begin, setBegin] = useState("");
    const [end, setEnd] = useState("");
    const [minAge, setMinAge] = useState("");
    const [maxAge, setMaxAge] = useState("");
    const [memberPrice, setMemberPrice] = useState("");
    const [nonMemberPrice, setNonMemberPrice] = useState("");
    const [maxParticipants, setMaxParticipants] = useState("");
    const [memberOnly, setMemberOnly] = useState(false);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [messageType, setMessageType] = useState<"success" | "error">("success");

    // Lead Mentor search state
    const [leadMentorId, setLeadMentorId] = useState("");
    const [mentorSearch, setMentorSearch] = useState("");
    const [mentorResults, setMentorResults] = useState<ParticipantOption[]>([]);
    const [mentorSearching, setMentorSearching] = useState(false);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            const isAuthorized = (session.user as any)?.sysadmin || (session.user as any)?.boardMember;
            if (!isAuthorized) {
                router.push('/admin');
            }
        }
    }, [status, router, session]);

    // Debounced mentor search
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (mentorSearch && !leadMentorId) {
                const searchMentors = async () => {
                    setMentorSearching(true);
                    try {
                        const res = await fetch(`/api/admin/participants/search?q=${encodeURIComponent(mentorSearch)}&filter=adults`);
                        if (res.ok) {
                            const data = await res.json();
                            setMentorResults(data.participants || []);
                        }
                    } finally {
                        setMentorSearching(false);
                    }
                };
                searchMentors();
            } else if (!mentorSearch) {
                setMentorResults([]);
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [mentorSearch, leadMentorId]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name) return;

        setSaving(true);
        setMessage("");

        try {
            const res = await fetch('/api/programs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name,
                    begin: begin || null,
                    end: end || null,
                    memberOnly,
                    minAge: minAge ? parseInt(minAge) : null,
                    maxAge: maxAge ? parseInt(maxAge) : null,
                    memberPrice: memberPrice ? parseInt(memberPrice) : null,
                    nonMemberPrice: nonMemberPrice ? parseInt(nonMemberPrice) : null,
                    maxParticipants: maxParticipants ? parseInt(maxParticipants) : null,
                    leadMentorId: leadMentorId ? parseInt(leadMentorId) : null
                })
            });

            if (res.ok) {
                const data = await res.json();
                router.push(`/admin/programs/${data.program.id}`);
            } else {
                const data = await res.json();
                setMessage(data.error || "Failed to create program.");
                setMessageType("error");
                setSaving(false);
            }
        } catch {
            setMessage("Network error creating program.");
            setMessageType("error");
            setSaving(false);
        }
    };

    if (status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading...</h2>
                </div>
            </main>
        );
    }

    if (!session) return null;

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '800px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>Create Program</h1>
                    <button className="glass-button" onClick={() => router.push('/programs')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Back to Programs
                    </button>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Create a new program. You can configure the roster and schedule events later.
                </p>

                {message && (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: messageType === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${messageType === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        borderRadius: '8px',
                        color: messageType === 'success' ? '#4ade80' : '#f87171',
                    }}>
                        {message}
                    </div>
                )}

                <div style={{ marginBottom: '2rem' }}>
                    <form onSubmit={handleCreate} style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Program Name</label>
                                <input
                                    type="text"
                                    className="glass-input"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                    placeholder="e.g. FRC Robotics 2026"
                                    required
                                    style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                />
                            </div>

                            {/* Lead Mentor Selector */}
                            <div style={{ position: 'relative' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Lead Mentor / Program Coordinator (Optional)</label>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        value={mentorSearch}
                                        onChange={e => { setMentorSearch(e.target.value); setLeadMentorId(""); }}
                                        style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                        placeholder="Search by name or email..."
                                    />
                                    {leadMentorId && (
                                        <button
                                            type="button"
                                            onClick={() => { setLeadMentorId(""); setMentorSearch(""); }}
                                            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.5rem', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                                {mentorSearching && <div style={{ position: 'absolute', right: '10px', top: '42px', color: 'gray', fontSize: '0.8rem' }}>Loading...</div>}
                                {mentorResults.length > 0 && !leadMentorId && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', zIndex: 10, maxHeight: '200px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', marginTop: '4px' }}>
                                        {mentorResults.map(p => (
                                            <div
                                                key={p.id}
                                                onClick={() => { setLeadMentorId(p.id.toString()); setMentorSearch(`${p.name || 'Unnamed'} (${p.email})`); setMentorResults([]); }}
                                                style={{ padding: '0.75rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                <div style={{ fontWeight: 500 }}>{p.name || 'Unnamed'}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>{p.email}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                    The lead mentor will be able to manage this program&apos;s roster and events.
                                </p>
                            </div>

                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Min Age (Optional)</label>
                                    <input
                                        type="number"
                                        className="glass-input"
                                        value={minAge}
                                        onChange={e => setMinAge(e.target.value)}
                                        style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Max Age (Optional)</label>
                                    <input
                                        type="number"
                                        className="glass-input"
                                        value={maxAge}
                                        onChange={e => setMaxAge(e.target.value)}
                                        style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Start Date</label>
                                    <input
                                        type="date"
                                        className="glass-input"
                                        value={begin}
                                        onChange={e => setBegin(e.target.value)}
                                        style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>End Date</label>
                                    <input
                                        type="date"
                                        className="glass-input"
                                        value={end}
                                        onChange={e => setEnd(e.target.value)}
                                        style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '1rem' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Member Price ($)</label>
                                    <input
                                        type="number"
                                        className="glass-input"
                                        value={memberPrice}
                                        onChange={e => setMemberPrice(e.target.value)}
                                        placeholder="0"
                                        style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Non-Member Price ($)</label>
                                    <input
                                        type="number"
                                        className="glass-input"
                                        value={nonMemberPrice}
                                        onChange={e => setNonMemberPrice(e.target.value)}
                                        placeholder="0"
                                        style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                    />
                                </div>
                            </div>
                            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Leave prices blank or 0 for a free program. Setting a price automatically creates a checkout flow on Shopify.</p>
                            {Number(memberPrice) > Number(nonMemberPrice) && (
                                <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '6px', fontSize: '0.85rem', color: '#eab308' }}>
                                    ⚠️ Member price is higher than non-member price.
                                </div>
                            )}
                            <div style={{ marginTop: '1rem' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Max Participants (Optional)</label>
                                <input
                                    type="number"
                                    className="glass-input"
                                    value={maxParticipants}
                                    onChange={e => setMaxParticipants(e.target.value)}
                                    placeholder="Leave blank for unlimited"
                                    min="1"
                                    style={{ width: '100%', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                                />
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Sets the inventory limit on Shopify. Leave blank for unlimited enrollment.</p>
                                {(memberPrice || nonMemberPrice) && !maxParticipants && (
                                    <div style={{ marginTop: '0.5rem', padding: '0.75rem', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)', borderRadius: '6px', fontSize: '0.85rem', color: '#eab308' }}>
                                        ⚠️ No max participants set — Shopify will allow unlimited purchases for this program.
                                    </div>
                                )}
                            </div>
                        </div>
                        <div style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <input
                                type="checkbox"
                                id="memberOnly"
                                checked={memberOnly}
                                onChange={e => setMemberOnly(e.target.checked)}
                                style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                            />
                            <label htmlFor="memberOnly" style={{ cursor: 'pointer', fontWeight: 500 }}>
                                Member-Only Program
                            </label>
                        </div>
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginTop: '0.25rem', marginBottom: '2rem' }}>
                            If checked, this program will only be visible to logged-in users with active memberships.
                        </p>
                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button type="submit" className="glass-button" disabled={saving || !name.trim()} style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                                {saving ? "Saving..." : "Create Program"}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </main>
    );
}
