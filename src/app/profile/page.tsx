"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../page.module.css';
import { formatDate, formatTime, formatDateTime } from '@/lib/time';

export default function ProfilePage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");

    const [form, setForm] = useState({
        name: "",
        email: "",
        dob: "",
        homeAddress: "",
        emailCheckinReceipts: false,
        emailNewsletter: false,
        notifyNewPrograms: true,
        notifyEventReminders: true
    });
    const [visits, setVisits] = useState<any[]>([]);
    const [filterDate, setFilterDate] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            fetchProfile();
            fetchVisits();
        }
    }, [status, router, filterDate]);

    const fetchProfile = async () => {
        try {
            const res = await fetch('/api/profile');
            if (res.ok) {
                const data = await res.json();
                const settings = data.profile.notificationSettings || {};
                setForm({
                    name: data.profile.name || "",
                    email: data.profile.email || "",
                    dob: data.profile.dob ? new Date(data.profile.dob).toISOString().split('T')[0] : "",
                    homeAddress: data.profile.homeAddress || "",
                    emailCheckinReceipts: settings.emailCheckinReceipts || false,
                    emailNewsletter: settings.emailNewsletter || false,
                    notifyNewPrograms: settings.notifyNewPrograms !== undefined ? settings.notifyNewPrograms : true,
                    notifyEventReminders: settings.notifyEventReminders !== undefined ? settings.notifyEventReminders : true
                });
            } else {
                setMessage("Failed to load profile.");
            }
        } catch (error) {
            setMessage("Network error loading profile.");
        } finally {
            setLoading(false);
        }
    };

    const fetchVisits = async () => {
        try {
            const res = await fetch(`/api/profile/visits?date=${filterDate}`);
            if (res.ok) {
                const data = await res.json();
                setVisits(data.visits || []);
            }
        } catch (error) {
            console.error("Error fetching visits:", error);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage("");

        try {
            const res = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name,
                    dob: form.dob || null,
                    homeAddress: form.homeAddress,
                    notificationSettings: {
                        emailCheckinReceipts: form.emailCheckinReceipts,
                        emailNewsletter: form.emailNewsletter,
                        notifyNewPrograms: form.notifyNewPrograms,
                        notifyEventReminders: form.notifyEventReminders
                    }
                })
            });

            if (res.ok) {
                setMessage("Profile updated successfully!");
                const data = await res.json();
                // Update local session name if needed, or simply let the next refresh handle it
            } else {
                setMessage("Failed to update profile.");
            }
        } catch (error) {
            setMessage("Network error saving profile.");
        } finally {
            setSaving(false);
        }
    };

    if (loading || status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading Profile...</h2>
                </div>
            </main>
        );
    }

    if (!session) return null; // Fallback while router redirects

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '600px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>My Profile</h1>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Manage your personal information and contact details.
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'left' }}>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Email Address</label>
                        <input
                            type="text"
                            className="glass-input"
                            value={form.email}
                            disabled
                            style={{ opacity: 0.6, cursor: 'not-allowed' }}
                            title="Email cannot be changed here."
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Full Name</label>
                        <input
                            type="text"
                            className="glass-input"
                            value={form.name}
                            onChange={(e) => setForm({ ...form, name: e.target.value })}
                            placeholder="e.g. Jane Doe"
                            required
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Date of Birth</label>
                        <input
                            type="date"
                            className="glass-input"
                            value={form.dob}
                            onChange={(e) => setForm({ ...form, dob: e.target.value })}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Home Address</label>
                        <textarea
                            className="glass-input"
                            value={form.homeAddress}
                            onChange={(e) => setForm({ ...form, homeAddress: e.target.value })}
                            placeholder="123 Main St..."
                            rows={3}
                            style={{ resize: 'vertical' }}
                        />
                    </div>

                    <button type="submit" className="glass-button" disabled={saving} style={{ marginTop: '1rem', background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}>
                        {saving ? 'Saving...' : 'Save Profile & Settings'}
                    </button>
                </form>

                {message && (
                    <div style={{
                        marginTop: '1.5rem',
                        padding: '1rem',
                        background: message.includes('success') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${message.includes('success') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        borderRadius: '8px',
                        color: message.includes('success') ? '#4ade80' : '#f87171',
                    }}>
                        {message}
                    </div>
                )}
            </div>

            <div className="glass-container animate-float" style={{ maxWidth: '600px', marginTop: '2rem' }}>
                <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Personal Settings</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={form.emailCheckinReceipts}
                            onChange={(e) => setForm({ ...form, emailCheckinReceipts: e.target.checked })}
                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                        />
                        <span style={{ color: 'var(--color-text)' }}>Email me when I check in or out</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={form.emailNewsletter}
                            onChange={(e) => setForm({ ...form, emailNewsletter: e.target.checked })}
                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                        />
                        <span style={{ color: 'var(--color-text)' }}>Subscribe to the weekly newsletter</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={form.notifyNewPrograms}
                            onChange={(e) => setForm({ ...form, notifyNewPrograms: e.target.checked })}
                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                        />
                        <span style={{ color: 'var(--color-text)' }}>Notify me when a new program is announced</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={form.notifyEventReminders}
                            onChange={(e) => setForm({ ...form, notifyEventReminders: e.target.checked })}
                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                        />
                        <span style={{ color: 'var(--color-text)' }}>Notify me before my events start</span>
                    </label>
                </div>
                <button
                    onClick={handleSubmit}
                    className="glass-button"
                    disabled={saving}
                    style={{ marginTop: '1.5rem', width: '100%', background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                    {saving ? 'Saving...' : 'Update Settings'}
                </button>
            </div>

            <div className="glass-container animate-float" style={{ maxWidth: '600px', marginTop: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Recent Check-ins</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <label htmlFor="history-date" style={{ fontSize: '0.9rem', color: 'var(--color-primary)' }}>Lookup Date:</label>
                        <input
                            id="history-date"
                            type="date"
                            className="glass-input"
                            value={filterDate || new Date().toISOString().split('T')[0]}
                            onChange={(e) => setFilterDate(e.target.value)}
                            style={{ padding: '0.3rem 0.5rem', width: 'auto' }}
                        />
                    </div>
                </div>

                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
                    {filterDate ? (
                        <>Showing activity from <strong>{formatDate(new Date(filterDate).getTime() - 7 * 24 * 60 * 60 * 1000)}</strong> to <strong>{formatDate(new Date(filterDate).getTime() + 7 * 24 * 60 * 60 * 1000)}</strong></>
                    ) : (
                        <>Showing activity for the <strong>past 7 days</strong></>
                    )}
                </p>

                {visits.length === 0 ? (
                    <p style={{ color: 'var(--color-text-muted)' }}>No historical visits found.</p>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                        {visits.map((v) => (
                            <div key={v.id} style={{
                                padding: '1rem',
                                background: 'rgba(255,255,255,0.05)',
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.1)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                flexWrap: 'wrap',
                                gap: '1rem'
                            }}>
                                <div>
                                    <strong style={{ display: 'block' }}>{v.event?.name || 'General Facility Visit'}</strong>
                                    <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                                        {formatDateTime(v.arrived)}
                                    </span>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: '0.9rem' }}>
                                    {v.departed ? (
                                        <span style={{ color: '#4ade80' }}>Departed {formatTime(v.departed)}</span>
                                    ) : (
                                        <span style={{ color: '#fbbf24' }}>Active Visit</span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </main>
    );
}
