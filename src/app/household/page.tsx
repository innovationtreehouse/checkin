"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../page.module.css';
import { formatDate, formatTime, formatDateTime } from '@/lib/time';

export default function HouseholdPage() {
    const { data: session, status } = useSession();
    const router = useRouter();

    const [loading, setLoading] = useState(true);
    const [household, setHousehold] = useState<{
        id?: number;
        name?: string;
        leads?: Array<{ participantId: number }>;
        participants?: Array<{ id: number; name?: string; email?: string; dob?: string; phone?: string; homeAddress?: string; programVolunteers?: Array<{ id: number; program: { name: string; end?: string }; events?: Array<{ start: string }> }>; programParticipants?: Array<{ id: number; program: { name: string; end?: string }; events?: Array<{ start: string }> }> }>;
        memberships?: Array<unknown>;
        emergencyContactName?: string;
        emergencyContactPhone?: string;
        address?: string;
    } | null>(null);
    const [message, setMessage] = useState("");
    const [addingMember, setAddingMember] = useState(false);

    const [creatingHousehold, setCreatingHousehold] = useState(false);

    const [memberForm, setMemberForm] = useState({
        name: "",
        email: "",
        dob: ""
    });

    const [editingMemberId, setEditingMemberId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({
        name: "",
        email: "",
        dob: "",
        phone: "",
        isLead: false
    });

    const [visits, setVisits] = useState<Array<{
        id: number;
        participant?: { name: string };
        event?: { name: string };
        arrived: string;
        departed?: string;
    }>>([]);
    const [filterDate, setFilterDate] = useState("");
    const [settings, setSettings] = useState({
        emailDependentCheckins: false
    });
    const [emergencyContactName, setEmergencyContactName] = useState("");
    const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
    const [address, setAddress] = useState("");
    const [savingSettings, setSavingSettings] = useState(false);

    useEffect(() => {
        if (status === "unauthenticated") {
            router.push('/');
        } else if (status === "authenticated") {
            fetchHousehold();
        }
    }, [status, router, filterDate]);

    const fetchHousehold = async () => {
        try {
            const [res, visitRes, profileRes] = await Promise.all([
                fetch('/api/household'),
                fetch(`/api/household/visits?date=${filterDate}`),
                fetch('/api/profile')
            ]);
            if (res.ok) {
                const data = await res.json();
                setHousehold(data.household);
                setEmergencyContactName(data.household?.emergencyContactName || "");
                setEmergencyContactPhone(data.household?.emergencyContactPhone || "");

                let initialAddress = data.household?.address || "";
                if (!initialAddress && data.household?.participants && data.household?.leads) {
                    const leadIds = data.household.leads.map((l: {participantId: number}) => l.participantId);
                    const leadParticipants = data.household.participants.filter((p: {id: number; name?: string; email?: string; dob?: string; homeAddress?: string}) => leadIds.includes(p.id));
                    const leadWithAddress = leadParticipants.find((p: {id: number; name?: string; email?: string; dob?: string; homeAddress?: string}) => p.homeAddress && p.homeAddress.trim() !== "");
                    if (leadWithAddress) {
                        initialAddress = leadWithAddress.homeAddress;
                    }
                }
                setAddress(initialAddress);
            }
            if (visitRes.ok) {
                const data = await visitRes.json();
                setVisits(data.visits || []);
            }
            if (profileRes.ok) {
                const data = await profileRes.json();
                setSettings({
                    emailDependentCheckins: data.profile.notificationSettings?.emailDependentCheckins || false
                });
            }
        } catch {
            setMessage("Network error loading household.");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveSettings = async () => {
        setSavingSettings(true);
        try {
            // Fetch current settings to merge
            const profileRes = await fetch('/api/profile');
            const profileData = await profileRes.json();
            const currentSettings = profileData.profile?.notificationSettings || {};

            const res = await fetch('/api/profile', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    notificationSettings: {
                        ...currentSettings,
                        emailDependentCheckins: settings.emailDependentCheckins
                    }
                })
            });
            // Save emergency contact and address to household settings
            const householdRes = await fetch('/api/household/settings', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    emergencyContactName,
                    emergencyContactPhone,
                    address
                })
            });

            if (res.ok && householdRes.ok) {
                setMessage("Settings updated successfully!");
                // refresh to get new data
                fetchHousehold();
            } else {
                setMessage("Failed to update some settings.");
            }
        } catch {
            setMessage("Network error saving settings.");
        } finally {
            setSavingSettings(false);
        }
    };

    const handleCreateHousehold = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/household', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            if (res.ok) {
                const data = await res.json();
                setHousehold(data.household);
                setMessage("Household created successfully!");
                setCreatingHousehold(false);
            } else {
                setMessage("Failed to create household.");
            }
        } catch {
            setMessage("Network error creating household.");
        } finally {
            setLoading(false);
        }
    };

    const handleAddMember = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage("");
        try {
            const res = await fetch('/api/household', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    memberName: memberForm.name,
                    memberEmail: memberForm.email,
                    memberDob: memberForm.dob
                })
            });

            const data = await res.json();

            if (res.ok) {
                setMessage(data.message || "Member added successfully!");
                setMemberForm({ name: "", email: "", dob: "" });
                setAddingMember(false);
                fetchHousehold(); // Refresh list
            } else {
                setMessage(data.error || "Failed to add member.");
            }
        } catch {
            setMessage("Network error adding member.");
        }
    };

    const handleEditMember = async (e: React.FormEvent, participantId: number) => {
        e.preventDefault();
        setMessage("");
        try {
            const res = await fetch('/api/household/member', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantId,
                    name: editForm.name,
                    email: editForm.email,
                    dob: editForm.dob,
                    phone: editForm.phone,
                    isLead: editForm.isLead
                })
            });

            const data = await res.json();
            if (res.ok) {
                setMessage("Member updated successfully!");
                setEditingMemberId(null);
                fetchHousehold();
            } else {
                setMessage(data.error || "Failed to update member.");
            }
        } catch {
            setMessage("Network error updating member.");
        }
    };

    const handleMakeLead = async (participantId: number) => {
        setMessage("");
        try {
            const res = await fetch('/api/household/lead', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId })
            });

            const data = await res.json();
            if (res.ok) {
                setMessage("Member promoted to lead successfully!");
                fetchHousehold();
            } else {
                setMessage(data.error || "Failed to promote member.");
            }
        } catch {
            setMessage("Network error promoting member.");
        }
    };

    if (loading || status === "loading") {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float">
                    <h2>Loading Household...</h2>
                </div>
            </main>
        );
    }

    if (!session) return null;

    return (
        <main className={styles.main}>
            <div className={`glass-container animate-float ${styles.heroContainer}`} style={{ maxWidth: '800px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>
                        {household?.name || 'My Household'}
                    </h1>
                    <button className="glass-button" onClick={() => router.push('/')} style={{ padding: '0.5rem 1rem' }}>
                        &larr; Back
                    </button>
                </div>

                {message && (
                    <div style={{
                        marginBottom: '1.5rem',
                        padding: '1rem',
                        background: message.includes('success') ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${message.includes('success') ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        borderRadius: '8px',
                        color: message.includes('success') ? '#4ade80' : '#f87171',
                    }}>
                        {message}
                    </div>
                )}

                {!household ? (
                    <div style={{ textAlign: 'center', padding: '2rem' }}>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
                            You are not currently part of a family household structure. Create one to add dependents or combine billing.
                        </p>

                        <button className="glass-button" onClick={handleCreateHousehold} style={{ background: 'rgba(168, 85, 247, 0.2)', borderColor: 'rgba(168, 85, 247, 0.4)' }}>
                            Register New Household
                        </button>
                    </div>
                ) : (
                    <div>
                        <div style={{ marginBottom: '2rem' }}>
                            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Household Members</h2>
                            <div className={styles.actionGrid} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
                                {(household.participants || [])
                                    .slice()
                                    .sort((a, b) => {
                                        const isLeadA = household.leads?.some(l => l.participantId === a.id) ? 1 : 0;
                                        const isLeadB = household.leads?.some(l => l.participantId === b.id) ? 1 : 0;
                                        
                                        // Sort leads to the top
                                        if (isLeadA !== isLeadB) {
                                            return isLeadB - isLeadA;
                                        }
                                        
                                        // If both are leads or both are not leads, sort by DOB (oldest first if DOB exists)
                                        if (a.dob && b.dob) {
                                            return new Date(a.dob).getTime() - new Date(b.dob).getTime();
                                        }
                                        if (a.dob) return -1;
                                        if (b.dob) return 1;
                                        
                                        // Final fallback to name
                                        return (a.name || "").localeCompare(b.name || "");
                                    })
                                    .map((p: {id: number; name?: string; email?: string; dob?: string; phone?: string; homeAddress?: string}) => (
                                    <div key={p.id} style={{
                                        padding: '1.5rem',
                                        background: 'rgba(255,255,255,0.05)',
                                        borderRadius: '12px',
                                        border: '1px solid rgba(255,255,255,0.1)',
                                        position: 'relative'
                                    }}>
                                        {editingMemberId === p.id ? (
                                            <form onSubmit={(e) => handleEditMember(e, p.id)} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', textAlign: 'left' }}>
                                                <input
                                                    type="text"
                                                    className="glass-input"
                                                    value={editForm.name}
                                                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                                                    placeholder="Name"
                                                    style={{ padding: '0.5rem' }}
                                                    required
                                                />
                                                <input
                                                    type="email"
                                                    className="glass-input"
                                                    value={editForm.email}
                                                    onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                                                    placeholder="Email"
                                                    style={{ padding: '0.5rem' }}
                                                />
                                                <input
                                                    type="date"
                                                    className="glass-input"
                                                    value={editForm.dob}
                                                    onChange={(e) => setEditForm({ ...editForm, dob: e.target.value })}
                                                    style={{ padding: '0.5rem' }}
                                                />
                                                <input
                                                    type="tel"
                                                    className="glass-input"
                                                    value={editForm.phone}
                                                    onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })}
                                                    placeholder="Phone"
                                                    style={{ padding: '0.5rem' }}
                                                />
                                                {p.id !== (session?.user as {id: number})?.id && editForm.dob && (new Date().getFullYear() - new Date(editForm.dob).getFullYear() >= 18) && (
                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginTop: '0.5rem', fontSize: '0.9rem' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={editForm.isLead}
                                                            onChange={(e) => setEditForm({ ...editForm, isLead: e.target.checked })}
                                                            style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                                                        />
                                                        <span style={{ color: 'var(--color-text)' }}>Household Lead</span>
                                                    </label>
                                                )}
                                                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                                                    <button type="submit" style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.4)', cursor: 'pointer' }}>Save</button>
                                                    <button type="button" onClick={() => setEditingMemberId(null)} style={{ padding: '0.25rem 0.5rem', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.1)', color: 'white', border: '1px solid rgba(255, 255, 255, 0.2)', cursor: 'pointer' }}>Cancel</button>
                                                </div>
                                            </form>
                                        ) : (
                                            <>
                                                <div style={{ paddingRight: '3rem' }}>
                                                    <h3 style={{ margin: '0 0 0.5rem 0', wordBreak: 'break-word' }}>{p.name || "Unnamed"}</h3>
                                                    {p.email && <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>{p.email}</p>}
                                                    {p.phone && <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)', wordBreak: 'break-word' }}>{p.phone}</p>}
                                                </div>
                                                {household.leads?.some((l: {participantId: number}) => l.participantId === p.id) && (
                                                    <span style={{
                                                        display: 'inline-block',
                                                        marginTop: '0.5rem',
                                                        background: 'rgba(168, 85, 247, 0.2)',
                                                        color: '#c084fc',
                                                        padding: '2px 8px',
                                                        borderRadius: '12px',
                                                        fontSize: '0.75rem'
                                                    }}>Household Lead</span>
                                                )}
                                                {!household.leads?.some((l: {participantId: number}) => l.participantId === p.id) &&
                                                    p.dob && (new Date().getFullYear() - new Date(p.dob).getFullYear() >= 18) &&
                                                    household.leads?.some((l: {participantId: number}) => l.participantId === (session?.user as {id: number})?.id) && (
                                                    <button
                                                        onClick={() => handleMakeLead(p.id)}
                                                        style={{
                                                            display: 'inline-block',
                                                            marginTop: '0.5rem',
                                                            background: 'rgba(59, 130, 246, 0.2)',
                                                            color: '#60a5fa',
                                                            padding: '4px 8px',
                                                            borderRadius: '8px',
                                                            fontSize: '0.75rem',
                                                            border: '1px solid rgba(59, 130, 246, 0.4)',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Make Lead
                                                    </button>
                                                )}
                                                {household.leads?.some((l: {participantId: number}) => l.participantId === (session?.user as {id: number})?.id) && (
                                                    <button
                                                        onClick={() => {
                                                            const isThisMemberALead = household.leads?.some((l: {participantId: number}) => l.participantId === p.id) || false;
                                                            setEditingMemberId(p.id);
                                                            setEditForm({ 
                                                                name: p.name || "", 
                                                                email: p.email || "", 
                                                                dob: p.dob ? new Date(p.dob).toISOString().split('T')[0] : "", 
                                                                phone: p.phone || "",
                                                                isLead: isThisMemberALead 
                                                            });
                                                        }}
                                                        style={{
                                                            position: 'absolute',
                                                            top: '1rem',
                                                            right: '1rem',
                                                            background: 'none',
                                                            border: 'none',
                                                            color: '#9ca3af',
                                                            cursor: 'pointer',
                                                            fontSize: '0.875rem',
                                                            textDecoration: 'underline'
                                                        }}
                                                    >
                                                        Edit
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {!addingMember ? (
                            <button
                                className="glass-button"
                                onClick={() => setAddingMember(true)}
                                style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}
                            >
                                + Add Household Member
                            </button>
                        ) : (
                            <form onSubmit={handleAddMember} style={{ padding: '1.5rem', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', textAlign: 'left' }}>
                                <h3 style={{ marginTop: 0 }}>Household Member Registration</h3>
                                <p style={{ color: 'var(--color-text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                                    If you enter an email address, their account will be correctly linked to this household the first time they log in via Google. Leave the email blank if they are a student dependent who will not sign in themselves.
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Full Name</label>
                                        <input
                                            type="text"
                                            className="glass-input"
                                            value={memberForm.name}
                                            onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Email (Optional)</label>
                                        <input
                                            type="email"
                                            className="glass-input"
                                            value={memberForm.email}
                                            onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
                                            placeholder="spouse@example.com"
                                        />
                                    </div>
                                    <div>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Date of Birth (Optional)</label>
                                        <input
                                            type="date"
                                            className="glass-input"
                                            value={memberForm.dob}
                                            onChange={(e) => setMemberForm({ ...memberForm, dob: e.target.value })}
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                                        <button type="submit" className="glass-button" style={{ flex: 1, background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                                            Save / Invite Member
                                        </button>
                                        <button type="button" className="glass-button" onClick={() => setAddingMember(false)} style={{ flex: 1 }}>
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </form>
                        )}
                    </div>
                )}
            </div>

            {household && household.leads?.some((l: {participantId: number}) => l.participantId === (session?.user as {id: number})?.id) && (
                <div className="glass-container animate-float" style={{ maxWidth: '800px', marginTop: '2rem' }}>
                    <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem' }}>Household Settings</h2>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={settings.emailDependentCheckins}
                                onChange={(e) => setSettings({ ...settings, emailDependentCheckins: e.target.checked })}
                                style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                            />
                            <span style={{ color: 'var(--color-text)' }}>Email me realtime receipts when my dependents check in/out</span>
                        </label>

                        <div style={{ marginTop: '1rem', padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#60a5fa' }}>Primary Address</h3>
                            <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>The main address associated with this household.</p>
                            <div>
                                <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Address</label>
                                <input
                                    type="text"
                                    className="glass-input"
                                    value={address}
                                    onChange={(e) => setAddress(e.target.value)}
                                    placeholder="123 Main St, City, ST 12345"
                                    style={{ width: '100%', padding: '0.75rem' }}
                                />
                            </div>
                        </div>
                        
                        <div style={{ marginTop: '1rem', padding: '1.5rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem', color: '#fcd34d' }}>Emergency Contact</h3>
                            <p style={{ margin: '0 0 1rem 0', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>Required for all households. This contact applies to all members of this household.</p>
                            
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.5rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Contact Name</label>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        value={emergencyContactName}
                                        onChange={(e) => setEmergencyContactName(e.target.value)}
                                        placeholder="Full Name"
                                        style={{ width: '100%', padding: '0.75rem' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', color: 'var(--color-primary)' }}>Contact Phone Number</label>
                                    <input
                                        type="tel"
                                        className="glass-input"
                                        value={emergencyContactPhone}
                                        onChange={(e) => setEmergencyContactPhone(e.target.value)}
                                        placeholder="(555) 555-5555"
                                        style={{ width: '100%', padding: '0.75rem' }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={handleSaveSettings}
                        className="glass-button"
                        disabled={savingSettings}
                        style={{ marginTop: '1.5rem', width: '100%', background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}>
                        {savingSettings ? 'Saving...' : 'Update Household Settings'}
                    </button>
                </div>
            )}

            {household && (
                <div className="glass-container animate-float" style={{ maxWidth: '800px', marginTop: '2rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                        <h2 style={{ fontSize: '1.5rem', margin: 0 }}>Household Check-ins</h2>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <label htmlFor="history-date" style={{ fontSize: '0.9rem', color: 'var(--color-primary)' }}>Lookup Date:</label>
                            <input
                                id="history-date"
                                type="date"
                                className="glass-input"
                                value={filterDate || new Date().toISOString().split('T')[0]}
                                onChange={(e) => setFilterDate(e.target.value)}
                                style={{ padding: '0.3rem 0.5rem', width: 'auto' }}
                            />
                        </div>
                    </div>

                    <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>
                        {filterDate ? (
                            <>Showing activity from <strong>{formatDate(new Date(filterDate).getTime() - 7 * 24 * 60 * 60 * 1000)}</strong> to <strong>{formatDate(new Date(filterDate).getTime() + 7 * 24 * 60 * 60 * 1000)}</strong></>
                        ) : (
                            <>Showing activity for the <strong>past 7 days</strong></>
                        )}
                    </p>

                    {visits.length === 0 ? (
                        <p style={{ color: 'var(--color-text-muted)' }}>No historical visits found for your household.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', textAlign: 'left' }}>
                            {visits.map((v) => (
                                <div key={v.id} style={{
                                    padding: '1rem',
                                    background: 'rgba(255,255,255,0.05)',
                                    borderRadius: '8px',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <div>
                                        <strong style={{ display: 'block', color: 'var(--color-primary)' }}>{v.participant?.name || 'Unnamed Member'}</strong>
                                        <span style={{ fontSize: '0.9rem', color: 'var(--color-text)' }}>{v.event?.name || 'General Facility Visit'} </span>
                                        <span style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
                                            &bull; {formatDateTime(v.arrived)}
                                        </span>
                                    </div>
                                    <div style={{ textAlign: 'right', fontSize: '0.9rem' }}>
                                        {v.departed ? (
                                            <span style={{ color: '#4ade80' }}>Departed {formatTime(v.departed)}</span>
                                        ) : (
                                            <span style={{ color: '#fbbf24' }}>Active Visit</span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </main>
    );
}
