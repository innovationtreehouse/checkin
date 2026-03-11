"use client";
/* eslint-disable @typescript-eslint/no-explicit-any, react/no-unescaped-entities */

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../../../page.module.css';

export default function CreateToolPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [newToolName, setNewToolName] = useState("");
    const [newToolGuide, setNewToolGuide] = useState("");
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        }
    }, [status, router]);

    const handleCreateTool = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setMessage("");

        try {
            const res = await fetch('/api/shop/tools', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newToolName, safetyGuide: newToolGuide })
            });

            if (res.ok) {
                setMessage("New tool added successfully!");
                setNewToolName("");
                setNewToolGuide("");
            } else {
                const data = await res.json();
                setMessage(data.error || "Failed to create tool.");
            }
        } finally {
            setSaving(false);
        }
    };

    if (status === "loading") {
        return <main className={styles.main}><div className="glass-container animate-float">Loading...</div></main>;
    }

    const isAdmin = (session?.user as any)?.boardMember || (session?.user as any)?.sysadmin;

    if (!isAdmin) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Access Denied</h2>
                    <p style={{ color: '#ef4444' }}>Forbidden: Only Admins and Board Members can define new tools.</p>
                    <button className="glass-button" onClick={() => router.push('/shop')}>Back to Shop Ops</button>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.main}>
            <div className={`glass-container`} style={{ maxWidth: '600px', width: '100%', margin: '2rem auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0, fontSize: '2rem' }}>Register New Tool</h1>
                    <Link href="/shop" className="glass-button" style={{ textDecoration: 'none' }}>
                        &larr; Shop Dashboard
                    </Link>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Define a new piece of shop equipment to begin tracking safety certifications,
                    authorizing Certifiers, and tracking usage.
                </p>

                {message && (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: message.includes('success') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid',
                        borderColor: message.includes('success') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        color: message.includes('success') ? '#4ade80' : '#ef4444'
                    }}>
                        {message}
                    </div>
                )}

                <form onSubmit={handleCreateTool} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>Equipment Name *</label>
                        <input
                            type="text"
                            className="glass-input"
                            placeholder="e.g. SawStop Table Saw"
                            required
                            value={newToolName}
                            onChange={e => setNewToolName(e.target.value)}
                            style={{ width: '100%', padding: '0.75rem', fontSize: '1.1rem' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>Safety Guide URL</label>
                        <input
                            type="url"
                            className="glass-input"
                            placeholder="https://example.com/safety-manual"
                            value={newToolGuide}
                            onChange={e => setNewToolGuide(e.target.value)}
                            style={{ width: '100%', padding: '0.75rem', fontSize: '1.1rem' }}
                        />
                        <p style={{ fontSize: '0.85rem', color: 'gray', marginTop: '0.5rem' }}>Optional link to the tool's required reading or manufacturer manual.</p>
                    </div>

                    <button
                        type="submit"
                        className="glass-button"
                        disabled={saving}
                        style={{
                            marginTop: '1rem',
                            padding: '1rem',
                            fontSize: '1.1rem',
                            background: 'rgba(56, 189, 248, 0.2)',
                            borderColor: 'rgba(56, 189, 248, 0.5)',
                        }}
                    >
                        {saving ? "Registering..." : "Create Tool"}
                    </button>
                </form>
            </div>
        </main>
    );
}
