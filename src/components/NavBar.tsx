"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import Link from 'next/link';

export default function NavBar() {
    const { data: session } = useSession();
    const router = useRouter();
    const pathname = usePathname();

    // Don't show navigation on the homepage if they aren't signed in
    if (!session && pathname === '/') return null;

    return (
        <nav style={{
            position: 'fixed',
            top: 0, left: 0, right: 0,
            height: '70px',
            background: 'rgba(15, 23, 42, 0.8)',
            backdropFilter: 'blur(12px)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 2rem',
            zIndex: 1000
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
                <Link href="/" style={{ textDecoration: 'none' }}>
                    <h2 className="text-gradient" style={{ margin: 0, fontSize: '1.5rem', cursor: 'pointer' }}>
                        CheckMeIn
                    </h2>
                </Link>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <Link href="/kioskdisplay" style={{ color: pathname === '/kioskdisplay' ? 'white' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                        Attendance
                    </Link>
                    {session && (
                        <Link href="/household" style={{ color: pathname === '/household' ? 'white' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                            My Household
                        </Link>
                    )}
                    <Link href="/programs" style={{ color: pathname === '/programs' ? 'white' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                        Programs
                    </Link>
                    {((session?.user as any)?.sysadmin || (session?.user as any)?.boardMember || (session?.user as any)?.shopSteward || (session?.user as any)?.toolStatuses?.some((ts: any) => ts.level === 'MAY_CERTIFY_OTHERS')) && (
                        <Link href="/shop" style={{ color: pathname === '/shop' ? '#fcd34d' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                            Shop Ops
                        </Link>
                    )}
                    {((session?.user as any)?.sysadmin) && (
                        <Link href="/admin" style={{ color: pathname === '/admin' ? '#f87171' : 'var(--color-text-muted)', textDecoration: 'none', fontWeight: 'bold' }}>
                            Admin Ops
                        </Link>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                {session ? (
                    <>
                        <button
                            onClick={() => router.push('/profile')}
                            style={{
                                background: 'transparent',
                                border: '1px solid rgba(255,255,255,0.2)',
                                color: 'white',
                                padding: '0.4rem 1rem',
                                borderRadius: '8px',
                                cursor: 'pointer'
                            }}
                        >
                            My Profile
                        </button>
                        <button
                            onClick={() => signOut()}
                            style={{
                                background: 'rgba(239, 68, 68, 0.2)',
                                border: '1px solid rgba(239, 68, 68, 0.4)',
                                color: 'var(--color-text)',
                                padding: '0.4rem 1rem',
                                borderRadius: '8px',
                                cursor: 'pointer'
                            }}
                        >
                            Sign Out
                        </button>
                    </>
                ) : (
                    <button
                        onClick={() => signIn('google')}
                        style={{
                            background: 'rgba(59, 130, 246, 0.2)',
                            border: '1px solid rgba(59, 130, 246, 0.4)',
                            color: 'var(--color-text)',
                            padding: '0.4rem 1rem',
                            borderRadius: '8px',
                            cursor: 'pointer'
                        }}
                    >
                        Sign In To Dashboard
                    </button>
                )}
            </div>
        </nav>
    );
}
