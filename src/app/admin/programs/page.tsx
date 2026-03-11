"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../../page.module.css";

export default function AdminProgramsIndex() {
    const [programs, setPrograms] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const router = useRouter();

    useEffect(() => {
        fetch('/api/programs')
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) {
                    setPrograms(data);
                }
                setLoading(false);
            })
            .catch(err => {
                console.error(err);
                setLoading(false);
            });
    }, []);

    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <div className="glass-container animate-float" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1 className="text-gradient" style={{ marginTop: 0 }}>Programs</h1>
                    <p style={{ color: 'var(--color-text-muted)' }}>
                        Manage recurring programs and curriculum tracks.
                    </p>
                </div>
                <button 
                    className="glass-button" 
                    onClick={() => router.push('/admin/programs/new')}
                    style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}
                >
                    + New Program
                </button>
            </div>

            <div className="glass-container" style={{ padding: '1rem' }}>
                {loading ? (
                    <p style={{ textAlign: 'center', padding: '2rem' }}>Loading programs...</p>
                ) : programs.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '2rem' }}>No programs found. Create your first one!</p>
                ) : (
                    <div style={{ display: 'grid', gap: '1rem' }}>
                        {programs.map(program => (
                            <div 
                                key={program.id} 
                                className="glass-container" 
                                style={{ 
                                    padding: '1.25rem', 
                                    display: 'flex', 
                                    justifyContent: 'space-between', 
                                    alignItems: 'center',
                                    background: 'rgba(255,255,255,0.03)',
                                    cursor: 'pointer'
                                }}
                                onClick={() => router.push(`/admin/programs/${program.id}`)}
                            >
                                <div>
                                    <h3 style={{ margin: 0 }}>{program.name}</h3>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '0.25rem' }}>
                                        {program._count?.participants || 0} Participants • {program._count?.events || 0} Events
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <span style={{ 
                                        padding: '4px 8px', 
                                        borderRadius: '4px', 
                                        fontSize: '0.75rem', 
                                        background: program.memberOnly ? 'rgba(168, 85, 247, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                                        color: program.memberOnly ? '#d8b4fe' : '#93c5fd'
                                    }}>
                                        {program.memberOnly ? 'Member Only' : 'Public'}
                                    </span>
                                    <span style={{ fontSize: '1.25rem' }}>&rarr;</span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
