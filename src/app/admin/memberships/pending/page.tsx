"use client";

import React, { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

export default function PendingMembershipsAdminPage() {
    const { data: session } = useSession();
    const user = session?.user as any;
    const isBoardMember = user?.boardMember || user?.sysadmin;

    const [households, setHouseholds] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [certifyingId, setCertifyingId] = useState<number | null>(null);

    const fetchPending = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/admin/memberships/pending');
            const data = await res.json();
            if (data.households) {
                setHouseholds(data.households);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isBoardMember) {
            fetchPending();
        }
    }, [isBoardMember]);

    const handleCertify = async (householdId: number) => {
        if (!confirm("I certify that I have independently verified a clean background check for the primary lead of this household.")) return;
        
        setCertifyingId(householdId);
        try {
            const res = await fetch('/api/admin/memberships/certify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ householdId })
            });
            const data = await res.json();
            if (data.success) {
                alert(data.status === 'APPROVED' ? 'Household Approved!' : 'Certification recorded. Waiting for 2nd board member.');
                fetchPending();
            } else {
                alert(data.error || "Failed to certify");
            }
        } catch (error) {
            console.error(error);
            alert("Network error");
        } finally {
            setCertifyingId(null);
        }
    };

    if (!isBoardMember) return <div style={{ padding: '2rem' }}>Unauthorized</div>;

    if (loading) return <div style={{ padding: '2rem' }}>Loading pending memberships...</div>;

    return (
        <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto' }}>
            <h1 className="text-gradient" style={{ fontSize: '2rem', marginBottom: '2rem' }}>Pending Memberships Verification</h1>
            
            {households.length === 0 ? (
                <div className="glass-container" style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>
                    No households are currently pending background check verification.
                </div>
            ) : (
                <div style={{ display: 'grid', gap: '1.5rem' }}>
                    {households.map(hh => {
                        const hasCertified = hh.backgroundCheckCertifications.some((c: any) => c.certifiedById === user.id);
                        const primaryLead = hh.leads.find((l: any) => l.isPrimary)?.participant || hh.leads[0]?.participant;

                        return (
                            <div key={hh.id} className="glass-container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-primary)' }}>Household #{hh.id}</h3>
                                    <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>Primary Lead: {primaryLead?.name || 'Unknown'}</p>
                                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem' }}>Status: Pending Background Check</p>
                                    
                                    <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Certified By:</span>
                                        {hh.backgroundCheckCertifications.length === 0 ? (
                                            <span style={{ fontSize: '0.85rem' }}>None yet</span>
                                        ) : (
                                            hh.backgroundCheckCertifications.map((cert: any) => (
                                                <span key={cert.id} style={{ background: 'rgba(59, 130, 246, 0.2)', padding: '0.2rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem' }}>
                                                    {cert.certifiedBy?.name}
                                                </span>
                                            ))
                                        )}
                                    </div>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', alignItems: 'flex-end', minWidth: '220px' }}>
                                    <a 
                                        href={`https://background-check-provider.example.com/verify?name=${encodeURIComponent(primaryLead?.name || '')}`} 
                                        target="_blank" 
                                        rel="noreferrer"
                                        className="glass-button" 
                                        style={{ fontSize: '0.85rem', padding: '0.5rem 1rem', width: '100%' }}
                                    >
                                        🌐 Click here to check website
                                    </a>
                                    
                                    <button 
                                        className="glass-button" 
                                        style={{ 
                                            background: hasCertified ? 'rgba(255,255,255,0.05)' : 'var(--color-primary)', 
                                            color: hasCertified ? 'var(--color-text-muted)' : '#fff',
                                            border: 'none',
                                            fontSize: '0.85rem', padding: '0.5rem 1rem', width: '100%'
                                        }}
                                        disabled={hasCertified || certifyingId === hh.id}
                                        onClick={() => handleCertify(hh.id)}
                                    >
                                        {certifyingId === hh.id ? 'Certifying...' : hasCertified ? '✓ You Certified' : '✓ Certify Background Check'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
