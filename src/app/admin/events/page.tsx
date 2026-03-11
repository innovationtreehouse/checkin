"use client";
/* eslint-disable @typescript-eslint/no-unused-vars */

import { useRouter } from "next/navigation";
import styles from "../../page.module.css";

export default function AdminEventsIndex() {
    const router = useRouter();

    const sections = [
        {
            title: "Visit History",
            description: "View and edit past check-in/out records.",
            link: "/admin/events/visits",
            icon: "🕒",
            color: "rgba(59, 130, 246, 0.2)"
        },
        {
            title: "Live Badge Logs",
            description: "Audit real-time RFID tap events across the facility.",
            link: "/admin/events/badges",
            icon: "📡",
            color: "rgba(168, 85, 247, 0.2)"
        },
        {
            title: "Create New Event",
            description: "Schedule a one-off event or manual session.",
            link: "/admin/events/new",
            icon: "➕",
            color: "rgba(34, 197, 94, 0.2)"
        }
    ];

    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
            <div className="glass-container animate-float" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <h1 className="text-gradient" style={{ marginTop: 0 }}>Events Management</h1>
                <p style={{ color: 'var(--color-text-muted)' }}>
                    Manage facility sessions, audit logs, and historical visit records.
                </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>
                {sections.map(section => (
                    <button
                        key={section.link}
                        className="glass-button"
                        onClick={() => router.push(section.link)}
                        style={{ 
                            background: section.color, 
                            borderColor: section.color.replace('0.2', '0.4'), 
                            padding: '2rem', 
                            fontSize: '1.25rem', 
                            flexDirection: 'column',
                            textAlign: 'center',
                            height: '100%'
                        }}
                    >
                        <span style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>{section.icon}</span>
                        <strong>{section.title}</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '0.95rem', color: 'var(--color-text-muted)' }}>{section.description}</p>
                    </button>
                ))}
            </div>
        </div>
    );
}
