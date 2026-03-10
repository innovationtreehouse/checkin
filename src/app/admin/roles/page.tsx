"use client";

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../../page.module.css';

type UserRole = {
    id: number;
    name: string | null;
    email: string;
    sysadmin: boolean;
    boardMember: boolean;
    keyholder: boolean;
    shopSteward: boolean;
};

type SessionUser = {
    id: number;
    sysadmin?: boolean;
    keyholder?: boolean;
    boardMember?: boolean;
    householdId?: number | null;
};

export default function RoleAssignmentPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [users, setUsers] = useState<UserRole[]>([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");
    const [savingId, setSavingId] = useState<number | null>(null);
    const [userSearchText, setUserSearchText] = useState("");

    const currentUserIsSysadmin = (session?.user as SessionUser)?.sysadmin || false;

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            const isAuthorized = (session.user as SessionUser)?.sysadmin || (session.user as SessionUser)?.boardMember;
            if (!isAuthorized) {
                router.push('/');
            } else {
                fetchUsers();
            }
        }
    }, [status, router, session]);

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/admin/roles');
            if (res.ok) {
                const data = await res.json();
                setUsers(data.participants);
            } else {
                setMessage("Failed to load user list.");
            }
        } catch {
            setMessage("Network error loading users.");
        } finally {
            setLoading(false);
        }
    };

    const handleRoleChange = async (userId: number, field: keyof UserRole, value: boolean) => {
        setSavingId(userId);
        setMessage("");

        // Optimistic update
        setUsers(users.map(u => u.id === userId ? { ...u, [field]: value } : u));

        try {
            const res = await fetch('/api/admin/roles', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    targetUserId: userId,
                    [field]: value
                })
            });

            if (!res.ok) {
                const data = await res.json();
                setMessage(data.error || "Failed to update role.");
                // Revert optimistic update
                fetchUsers();
            }
        } catch {
            setMessage("Network error updating role.");
            fetchUsers();
        } finally {
            setSavingId(null);
        }
    };

    if (loading || status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading...</h2>
                </div>
            </main>
        );
    }

    if (!session) return null;

    const filteredUsers = users.filter(u =>
    ((u.name || "").toLowerCase().includes((userSearchText || "").toLowerCase()) ||
        (u.email || "").toLowerCase().includes((userSearchText || "").toLowerCase()))
    );

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '1000px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>Role Assignment</h1>
                    <button className="glass-button" onClick={() => router.push('/admin')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Back to Admin Hub
                    </button>
                </div>

                <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                    Manage administrative privileges and access levels for community members. Checkboxes save automatically.
                </p>

                {message && (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        color: '#f87171',
                    }}>
                        {message}
                    </div>
                )}

                <div style={{ marginBottom: '1.5rem' }}>
                    <input
                        type="text"
                        placeholder="Search users by name or email..."
                        className="glass-input"
                        style={{ width: '100%', maxWidth: '400px', padding: '0.75rem', background: 'rgba(0,0,0,0.2)', color: 'white' }}
                        value={userSearchText}
                        onChange={e => setUserSearchText(e.target.value)}
                    />
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.2)' }}>
                                <th style={{ padding: '1rem 0.5rem' }}>User</th>
                                <th style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>Sysadmin</th>
                                <th style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>Board Member</th>
                                <th style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>Keyholder</th>
                                <th style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>Shop Steward</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredUsers.map(user => (
                                <tr key={user.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <td style={{ padding: '1rem 0.5rem' }}>
                                        <div style={{ fontWeight: 500 }}>{user.name || 'Unnamed'}</div>
                                        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>{user.email}</div>
                                    </td>
                                    <td style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={user.sysadmin}
                                            disabled={savingId === user.id || !currentUserIsSysadmin}
                                            onChange={(e) => handleRoleChange(user.id, 'sysadmin', e.target.checked)}
                                            style={{ width: '1.2rem', height: '1.2rem', cursor: currentUserIsSysadmin ? 'pointer' : 'not-allowed' }}
                                        />
                                    </td>
                                    <td style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={user.boardMember}
                                            disabled={savingId === user.id}
                                            onChange={(e) => handleRoleChange(user.id, 'boardMember', e.target.checked)}
                                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                                        />
                                    </td>
                                    <td style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={user.keyholder}
                                            disabled={savingId === user.id}
                                            onChange={(e) => handleRoleChange(user.id, 'keyholder', e.target.checked)}
                                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                                        />
                                    </td>
                                    <td style={{ padding: '1rem 0.5rem', textAlign: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={user.shopSteward}
                                            disabled={savingId === user.id}
                                            onChange={(e) => handleRoleChange(user.id, 'shopSteward', e.target.checked)}
                                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </main>
    );
}
