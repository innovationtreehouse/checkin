"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import styles from "../page.module.css";

export default function AdminDashboardIndex() {
    const { data: session } = useSession();
    const router = useRouter();
    const [orphans, setOrphans] = useState<any[]>([]);

    useEffect(() => {
        fetch('/api/admin/orphans')
            .then(res => res.json())
            .then(data => {
                if (data.orphans) {
                    setOrphans(data.orphans);
                }
            })
            .catch(console.error);
    }, []);

    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <div className="glass-container animate-float" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h1 className="text-gradient" style={{ marginTop: 0 }}>Admin Dashboard</h1>
                <p style={{ color: 'var(--color-text-muted)' }}>
                    Welcome back, {(session?.user as any)?.name || 'Admin'}. Here is an overview of the facility status and pending tasks.
                </p>
            </div>

            {orphans.length > 0 && (
                <div style={{ 
                    background: 'rgba(239, 68, 68, 0.15)', 
                    border: '1px solid rgba(239, 68, 68, 0.3)', 
                    color: '#fca5a5', 
                    padding: '1.5rem', 
                    borderRadius: '12px', 
                    marginBottom: '2rem',
                    boxShadow: '0 4px 15px rgba(239, 68, 68, 0.1)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
                        <span style={{ fontSize: '1.5rem' }}>🚨</span>
                        <h2 style={{ fontSize: '1.25rem', margin: 0 }}>Attention Required</h2>
                    </div>
                    <p>There are {orphans.length} student(s) registered whose parents have not yet claimed their accounts. These students cannot be tracked correctly until their households are linked.</p>
                    <ul style={{ margin: '1rem 0 0 0', paddingLeft: '1.5rem', fontSize: '0.95rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                        {orphans.map(o => (
                            <li key={o.id} style={{ fontWeight: 500 }}>{o.name || o.email || `Student ID ${o.id}`}</li>
                        ))}
                    </ul>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                <div className="glass-container" style={{ padding: '1.5rem' }}>
                    <h3 style={{ marginTop: 0, color: 'var(--color-primary)' }}>Quick Stats</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1rem' }}>
                        <div style={{ textAlign: 'center', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>--</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Active Guests</div>
                        </div>
                        <div style={{ textAlign: 'center', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>--</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', textTransform: 'uppercase' }}>Check-ins Today</div>
                        </div>
                    </div>
                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: '1rem' }}>
                        Real-time stats are coming soon in the next update.
                    </p>
                </div>

                <div className="glass-container" style={{ padding: '1.5rem' }}>
                    <h3 style={{ marginTop: 0, color: 'var(--color-secondary)' }}>System Health</h3>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '1rem 0 0 0' }}>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <span>Database</span>
                            <span style={{ color: '#4ade80' }}>● Operational</span>
                        </li>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                            <span>RFID Gateway</span>
                            <span style={{ color: '#4ade80' }}>● Connected</span>
                        </li>
                        <li style={{ display: 'flex', justifyContent: 'space-between', padding: '0.5rem 0' }}>
                            <span>Last Backup</span>
                            <span style={{ color: 'var(--color-text-muted)' }}>2 hours ago</span>
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
