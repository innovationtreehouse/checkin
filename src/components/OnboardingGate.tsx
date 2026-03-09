"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';

export default function OnboardingGate({ children }: { children: React.ReactNode }) {
    const { status } = useSession();
    const pathname = usePathname();

    const [loading, setLoading] = useState(true);
    const [needsPhone, setNeedsPhone] = useState(false);
    const [needsEmergencyContact, setNeedsEmergencyContact] = useState(false);
    
    const [phone, setPhone] = useState("");
    const [emergencyContactName, setEmergencyContactName] = useState("");
    const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
    
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (status === "unauthenticated") {
            setLoading(false);
            return;
        }
        
        if (status === "authenticated") {
            checkStatus();
        }
    }, [status, pathname]);

    const checkStatus = async () => {
        try {
            const res = await fetch('/api/profile/onboarding-status');
            if (res.ok) {
                const data = await res.json();
                setNeedsPhone(data.needsPhone);
                setNeedsEmergencyContact(data.needsEmergencyContact);
            }
        } catch (err) {
            console.error("Failed to check onboarding status", err);
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        setError("");

        try {
            const payload: Record<string, string> = {};
            if (needsPhone && phone.trim()) {
                payload.phone = phone.trim();
            }
            if (needsEmergencyContact && emergencyContactName.trim() && emergencyContactPhone.trim()) {
                payload.emergencyContactName = emergencyContactName.trim();
                payload.emergencyContactPhone = emergencyContactPhone.trim();
            }

            const res = await fetch('/api/profile/onboarding', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (res.ok) {
                // Check status again to dismiss the modal
                await checkStatus();
            } else {
                const data = await res.json();
                setError(data.error || "Failed to save information");
            }
        } catch {
            setError("Network error");
        } finally {
            setSaving(false);
        }
    };

    const isBlocked = needsPhone || needsEmergencyContact;

    if (loading) {
        return <>{children}</>; 
    }

    if (!isBlocked) {
        return <>{children}</>;
    }

    return (
        <div style={{ position: 'relative' }}>
            <div style={{ 
                position: 'fixed', 
                top: 0, left: 0, right: 0, bottom: 0, 
                backgroundColor: 'rgba(0,0,0,0.85)', 
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1rem',
                backdropFilter: 'blur(5px)'
            }}>
                <div className="glass-container animate-float" style={{ maxWidth: '500px', width: '100%', padding: '2.5rem' }}>
                    <h2 style={{ fontSize: '2rem', marginBottom: '1rem', color: '#60a5fa' }}>Action Required</h2>
                    <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem', lineHeight: 1.5 }}>
                        To ensure the safety of our facility and compliance with our policies, we need a bit more contact information before you can proceed.
                    </p>

                    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', textAlign: 'left' }}>
                        {needsPhone && (
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)', fontWeight: 'bold' }}>Your Phone Number</label>
                                <input
                                    type="tel"
                                    className="glass-input"
                                    value={phone}
                                    onChange={(e) => setPhone(e.target.value)}
                                    required
                                    placeholder="(555) 123-4567"
                                    style={{ width: '100%' }}
                                />
                                <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Required for all adult participants.</p>
                            </div>
                        )}

                        {needsEmergencyContact && (
                            <div style={{ padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem', color: '#fcd34d' }}>Household Emergency Contact</h3>
                                <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>As a household lead, you must designate an emergency contact for your household members.</p>
                                <div style={{ marginBottom: '1rem' }}>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)', fontWeight: 'bold' }}>Contact Name</label>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        value={emergencyContactName}
                                        onChange={(e) => setEmergencyContactName(e.target.value)}
                                        required
                                        placeholder="Jane Doe"
                                        style={{ width: '100%' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)', fontWeight: 'bold' }}>Contact Phone</label>
                                    <input
                                        type="tel"
                                        className="glass-input"
                                        value={emergencyContactPhone}
                                        onChange={(e) => setEmergencyContactPhone(e.target.value)}
                                        required
                                        placeholder="(555) 987-6543"
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </div>
                        )}

                        {error && (
                            <div style={{ color: '#f87171', background: 'rgba(239, 68, 68, 0.1)', padding: '1rem', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                                {error}
                            </div>
                        )}

                        <button 
                            type="submit" 
                            className="glass-button" 
                            disabled={saving} 
                            style={{ 
                                marginTop: '1rem', 
                                background: 'rgba(59, 130, 246, 0.2)', 
                                borderColor: 'rgba(59, 130, 246, 0.4)',
                                padding: '1rem',
                                fontSize: '1.1rem',
                                fontWeight: 'bold'
                            }}
                        >
                            {saving ? 'Saving...' : 'Save & Continue'}
                        </button>
                        
                        <button
                            type="button"
                            className="glass-button"
                            onClick={() => {
                                setNeedsPhone(false);
                                setNeedsEmergencyContact(false);
                            }}
                            disabled={saving}
                            style={{ 
                                marginTop: '0.5rem', 
                                background: 'transparent',
                                borderColor: 'transparent',
                                color: 'var(--color-text-muted)',
                                padding: '0.5rem',
                                fontSize: '0.9rem',
                            }}
                        >
                            Ask me next time
                        </button>
                    </form>
                </div>
            </div>
            
            {/* Render children behind the modal but render them anyway */}
            <div style={{ filter: 'blur(3px)', pointerEvents: 'none', userSelect: 'none' }}>
                {children}
            </div>
        </div>
    );
}
