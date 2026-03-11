"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import styles from '../page.module.css';

export default function ShopStewardPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        }
    }, [status, router]);

    if (status === "loading") {
        return <main className={styles.main}><div className="glass-container animate-float"><h2>Loading...</h2></div></main>;
    }

    if (status === "unauthenticated") {
        return null;
    }

    const isSysadmin = (session?.user as any)?.sysadmin;
    const isBoardMember = (session?.user as any)?.boardMember;
    const isShopSteward = (session?.user as any)?.shopSteward;
    const isAdmin = isSysadmin || isBoardMember || isShopSteward;

    // Certifier check: either Shop Steward, Board Member, Admin, or explicitly has MAY_CERTIFY_OTHERS
    const certs = (session?.user as any)?.toolStatuses || [];
    const hasCertifierAuth = certs.some((ts: any) => ts.level === 'MAY_CERTIFY_OTHERS');
    const isCertifier = isSysadmin ||
        isBoardMember ||
        (session?.user as any)?.shopSteward ||
        hasCertifierAuth;

    if (!isCertifier && !isAdmin) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Access Denied</h2>
                    <p style={{ color: '#ef4444' }}>Forbidden: You require the Shop Steward, Admin, Board Member, or Certifier role to view this page.</p>
                    <button className="glass-button" onClick={() => router.push('/dashboard')}>Back to Dashboard</button>
                </div>
            </main>
        );
    }

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                    <div>
                        <h1 className="text-gradient" style={{ margin: 0, fontSize: '2.5rem' }}>Shop Operations</h1>
                        <p style={{ margin: '0.5rem 0 0 0', color: 'var(--color-text-muted)' }}>Centralized hub for tool management and safety certifications.</p>
                    </div>
                    <Link href="/dashboard" className="glass-button" style={{ textDecoration: 'none' }}>
                        &larr; Main Dashboard
                    </Link>
                </div>

                <div className={styles.actionGrid}>
                    {isAdmin && (
                        <button
                            className="glass-button"
                            onClick={() => router.push('/shop/tools/new')}
                            style={{ background: 'rgba(56, 189, 248, 0.2)', borderColor: 'rgba(56, 189, 248, 0.4)', padding: '2.5rem', fontSize: '1.25rem', flexDirection: 'column' }}
                        >
                            <span style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>&#10024;</span>
                            <strong>Create Tool</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '1rem', color: 'var(--color-text)' }}>Register a new tool definition and safety guide into the database.</p>
                        </button>
                    )}

                    {isCertifier && (
                        <button
                            className="glass-button"
                            onClick={() => router.push('/shop/tools')}
                            style={{ background: 'rgba(234, 179, 8, 0.2)', borderColor: 'rgba(234, 179, 8, 0.4)', padding: '2.5rem', fontSize: '1.25rem', flexDirection: 'column', gridColumn: isAdmin ? 'span 1' : '1 / -1' }}
                        >
                            <span style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>&#128203;</span>
                            <strong>Manage Certifications</strong>
                            <p style={{ margin: '0.5rem 0 0 0', fontSize: '1rem', color: 'var(--color-text)' }}>Review master tool lists and grant safety clearance levels to fellow members.</p>
                        </button>
                    )}

                    <button
                        className="glass-button"
                        onClick={() => window.open('/kioskdisplay/certifications', '_blank')}
                        style={{ background: 'rgba(16, 185, 129, 0.2)', borderColor: 'rgba(16, 185, 129, 0.4)', padding: '2.5rem', fontSize: '1.25rem', flexDirection: 'column', gridColumn: '1 / -1' }}
                    >
                        <span style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>&#128202;</span>
                        <strong>Live Certifications Center</strong>
                        <p style={{ margin: '0.5rem 0 0 0', fontSize: '1rem', color: 'var(--color-text)' }}>View a live matrix of participants currently at the facility and their tool certifications.</p>
                    </button>
                </div>

            </div>
        </main>
    );
}
