"use client";

import { Suspense, useState } from 'react';
import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from 'next/link';
import styles from './NavBar.module.css';
import { config } from '@/lib/config';

type SessionUser = {
    sysadmin?: boolean;
    boardMember?: boolean;
    shopSteward?: boolean;
    toolStatuses?: Array<{ level: string }>;
};

function NavBarInner() {
    const { data: session } = useSession();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const toggleMobileMenu = () => setIsMobileMenuOpen(!isMobileMenuOpen);
    const closeMobileMenu = () => setIsMobileMenuOpen(false);

    // Hide navbar entirely in kiosk mode (mode=kiosk param, valid cert signature present, or kioskdisplay route)
    const isKioskMode = searchParams.get('mode') === 'kiosk' || searchParams.get('sig') || pathname?.startsWith('/kioskdisplay');
    if (isKioskMode) return null;

    // Don't show navigation on the homepage if they aren't signed in
    if (!session && pathname === '/') return null;

    const navLinks = (
        <>
            <Link href="/kioskdisplay" onClick={closeMobileMenu} style={{ color: pathname === '/kioskdisplay' ? 'white' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                Attendance
            </Link>
            {session && (
                <Link href="/household" onClick={closeMobileMenu} style={{ color: pathname === '/household' ? 'white' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                    My Household
                </Link>
            )}
            {session ? (
                <Link href="/programs" onClick={closeMobileMenu} style={{ color: pathname === '/programs' ? 'white' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                    Programs
                </Link>
            ) : null}
            {(session?.user as SessionUser)?.sysadmin || (session?.user as SessionUser)?.boardMember || (session?.user as SessionUser)?.shopSteward || (session?.user as SessionUser)?.toolStatuses?.some(ts => ts.level === 'MAY_CERTIFY_OTHERS') ? (
                <Link href="/shop" onClick={closeMobileMenu} style={{ color: pathname === '/shop' ? '#fcd34d' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                    Shop Ops
                </Link>
            ) : null}
            {(session?.user as SessionUser)?.sysadmin || (session?.user as SessionUser)?.boardMember ? (
                <Link href="/admin" onClick={closeMobileMenu} style={{ color: pathname === '/admin' ? '#f87171' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                    Admin Ops
                </Link>
            ) : null}
        </>
    );

    const authButtons = session ? (
        <>
            <button
                onClick={() => { router.push('/profile'); closeMobileMenu(); }}
                className="glass-button"
                style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}
            >
                My Profile
            </button>
            <button
                onClick={() => { signOut(); closeMobileMenu(); }}
                style={{
                    background: 'rgba(239, 68, 68, 0.2)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: 'var(--color-text)',
                    padding: '0.4rem 1rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '0.9rem'
                }}
            >
                Sign Out
            </button>
        </>
    ) : (
        <button
            onClick={() => { signIn('google'); closeMobileMenu(); }}
            className="glass-button"
            style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)', fontSize: '0.9rem' }}
        >
            Sign In To Dashboard
        </button>
    );

    return (
        <>
            <nav className={styles.navbar}>
                <div className={styles.leftSection}>
                    <Link href="/" onClick={closeMobileMenu} style={{ textDecoration: 'none' }}>
                        <h2 className="text-gradient" style={{ margin: 0, fontSize: '1.5rem', cursor: 'pointer' }}>
                            {config.isDev ? 'CMI-dev' : 'CheckMeIn'}
                        </h2>
                    </Link>
                    <div className={styles.navLinks}>
                        {navLinks}
                    </div>
                </div>

                <div className={styles.rightSection}>
                    {authButtons}
                </div>

                <button 
                    className={`${styles.hamburger} ${isMobileMenuOpen ? styles.open : ''}`} 
                    onClick={toggleMobileMenu}
                    aria-label="Toggle menu"
                >
                    <span></span>
                    <span></span>
                    <span></span>
                </button>
            </nav>

            <div className={`${styles.overlay} ${isMobileMenuOpen ? styles.open : ''}`} onClick={closeMobileMenu} />

            <div className={`${styles.mobileMenu} ${isMobileMenuOpen ? styles.open : ''}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {navLinks}
                    <hr style={{ border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', margin: '0.5rem 0' }} />
                    {authButtons}
                </div>
            </div>
        </>
    );
}

export default function NavBar() {
    return (
        <Suspense fallback={null}>
            <NavBarInner />
        </Suspense>
    );
}
