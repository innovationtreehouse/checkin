"use client";
/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../../page.module.css";

export default function AdminParticipantsIndex() {
    const [searchQuery, setSearchQuery] = useState("");
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    useEffect(() => {
        fetchParticipants();
    }, []);

    const fetchParticipants = async (query = "") => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/participants/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data.participants) {
                setResults(data.participants);
            }
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [selectedParticipant, setSelectedParticipant] = useState<any>(null);
    const [householdId, setHouseholdId] = useState("");
    const [householdSearch, setHouseholdSearch] = useState("");
    const [householdResults, setHouseholdResults] = useState<any[]>([]);
    const [householdSearching, setHouseholdSearching] = useState(false);
    const [assigning, setAssigning] = useState(false);
    const [showingNewHouseholdConfirm, setShowingNewHouseholdConfirm] = useState(false);
    const [notification, setNotification] = useState<{ message: string, type: 'success' | 'error' } | null>(null);

    // Edit Participant State
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [editingParticipant, setEditingParticipant] = useState<any>(null);
    const [editForm, setEditForm] = useState({ name: "", email: "", phone: "" });
    const [savingDetails, setSavingDetails] = useState(false);

    // Auto-clear notification
    useEffect(() => {
        if (notification) {
            const timer = setTimeout(() => setNotification(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [notification]);

    const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
        setNotification({ message, type });
    };

    // Debounced household search
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            if (householdSearch && !householdId) {
                const search = async () => {
                    setHouseholdSearching(true);
                    try {
                        const res = await fetch(`/api/admin/households?q=${encodeURIComponent(householdSearch)}`);
                        if (res.ok) {
                            const data = await res.json();
                            setHouseholdResults(data.households || []);
                        }
                    } finally {
                        setHouseholdSearching(false);
                    }
                };
                search();
            } else if (!householdSearch) {
                setHouseholdResults([]);
            }
        }, 300);
        return () => clearTimeout(timeoutId);
    }, [householdSearch, householdId]);

    const handleAssignHousehold = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedParticipant) return;

        // If pulling from an existing household into a NEW one, ask for confirmation
        if (selectedParticipant.household && !householdId && !showingNewHouseholdConfirm) {
            setShowingNewHouseholdConfirm(true);
            return;
        }

        setAssigning(true);
        try {
            const res = await fetch(`/api/admin/participants/${selectedParticipant.id}/household`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    householdId: householdId ? parseInt(householdId) : undefined,
                    createNew: !householdId
                })
            });
            if (res.ok) {
                const data = await res.json();
                setResults(results.map(p => p.id === selectedParticipant.id ? data.participant : p));
                setAssignModalOpen(false);
                setHouseholdId("");
                setHouseholdSearch("");
                setSelectedParticipant(null);
                setShowingNewHouseholdConfirm(false);
                showNotification("Household assigned successfully!");
            } else {
                const data = await res.json().catch(() => ({}));
                showNotification(data.error || "Failed to assign household", "error");
            }
        } catch (err) {
            console.error(err);
            showNotification("Network error", "error");
        } finally {
            setAssigning(false);
        }
    };

    const handleEditParticipant = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingParticipant) return;
        setSavingDetails(true);
        try {
            const res = await fetch(`/api/admin/participants/${editingParticipant.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(editForm)
            });
            if (res.ok) {
                const data = await res.json();
                // Merge updated fields back into results array
                setResults(results.map(p => p.id === editingParticipant.id ? { ...p, ...data.participant } : p));
                setEditModalOpen(false);
                setEditingParticipant(null);
                showNotification("Participant updated successfully!");
            } else {
                const data = await res.json().catch(() => ({}));
                showNotification(data.error || "Failed to update participant", "error");
            }
        } catch (err) {
            console.error(err);
            showNotification("Network error", "error");
        } finally {
            setSavingDetails(false);
        }
    };

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        fetchParticipants(searchQuery);
    };

    return (
        <div style={{ maxWidth: "1000px", margin: "0 auto", position: 'relative' }}>
            {notification && (
                <div 
                    className="glass-container animate-float" 
                    style={{ 
                        position: 'fixed', 
                        top: '20px', 
                        right: '20px', 
                        zIndex: 1000, 
                        background: notification.type === 'error' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(34, 197, 94, 0.9)',
                        border: '1px solid rgba(255,255,255,0.2)',
                        padding: '1rem 2rem',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                        backdropFilter: 'blur(10px)',
                        color: 'white',
                        fontWeight: 600
                    }}
                >
                    {notification.message}
                </div>
            )}
            <div className="glass-container animate-float" style={{ padding: '2rem', marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                    <h1 className="text-gradient" style={{ marginTop: 0 }}>Participants</h1>
                    <p style={{ color: 'var(--color-text-muted)' }}>
                        Search and manage system participants and households.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '1rem' }}>
                    <button 
                        className="glass-button" 
                        onClick={() => router.push('/admin/participants/import')}
                        style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}
                    >
                        Bulk Import
                    </button>
                    <button 
                        className="glass-button" 
                        onClick={() => router.push('/admin/participants/new')}
                        style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}
                    >
                        + New Participant
                    </button>
                </div>
            </div>

            <div className="glass-container" style={{ padding: '2rem', marginBottom: '2rem' }}>
                <form onSubmit={handleSearch} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                    <input 
                        type="text" 
                        placeholder="Search by name or email..." 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{ 
                            flex: 1, 
                            padding: '0.75rem 1rem', 
                            borderRadius: '8px', 
                            background: 'rgba(255,255,255,0.05)', 
                            border: '1px solid rgba(255,255,255,0.1)',
                            color: 'white',
                            fontSize: '1rem'
                        }}
                    />
                    <button type="submit" className="glass-button" disabled={loading}>
                        {loading ? 'Searching...' : 'Search'}
                    </button>
                </form>

                <div style={{ marginTop: '2rem' }}>
                    {results.length > 0 ? (
                        <div style={{ display: 'grid', gap: '1rem' }}>
                            {results.map(p => (
                                <div key={p.id} className="glass-container" style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                                    <div>
                                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                                        <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
                                            {p.email || 'No email'}{p.phone ? ` • ${p.phone}` : ''}
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                                        {p.household?.name || 'No household'}
                                        {!p.household && (
                                            <button 
                                                className="glass-button" 
                                                onClick={() => { setSelectedParticipant(p); setAssignModalOpen(true); }}
                                                style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(59, 130, 246, 0.2)' }}
                                            >
                                                Assign Household
                                            </button>
                                        )}
                                        <button 
                                            className="glass-button" 
                                            onClick={() => { 
                                                setEditingParticipant(p); 
                                                setEditForm({ name: p.name || "", email: p.email || "", phone: p.phone || "" });
                                                setEditModalOpen(true); 
                                            }}
                                            style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.1)' }}
                                        >
                                            Edit Details
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : searchQuery && !loading ? (
                        <p style={{ textAlign: 'center', color: 'var(--color-text-muted)' }}>No participants found.</p>
                    ) : null}
                </div>
            </div>

            {assignModalOpen && (
                <div 
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setAssignModalOpen(false);
                            setSelectedParticipant(null);
                        }
                    }}
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, backdropFilter: 'blur(8px)' }}
                >
                    <div className="glass-container" style={{ padding: '2rem', width: '100%', maxWidth: '500px', background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
                        <h2 style={{ marginTop: 0 }}>Assign Household to {selectedParticipant?.name}</h2>
                        
                        {selectedParticipant?.household && (
                            <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--color-text-muted)' }}>Current Household: {selectedParticipant.household.name}</div>
                                <div style={{ fontSize: '0.85rem' }}>
                                    Members: {selectedParticipant.household.participants
                                        .filter((p: any) => p.id !== selectedParticipant.id)
                                        .map((p: any) => p.name || p.email)
                                        .join(', ') || 'No other members'}
                                </div>
                            </div>
                        )}

                        <form onSubmit={handleAssignHousehold} style={{ position: 'relative' }}>
                            {showingNewHouseholdConfirm && (
                                <div style={{ 
                                    position: 'absolute', 
                                    top: '-10px', 
                                    left: '-10px', 
                                    right: '-10px', 
                                    bottom: '-10px', 
                                    background: 'rgba(15, 23, 42, 0.98)', 
                                    borderRadius: '8px', 
                                    display: 'flex', 
                                    flexDirection: 'column', 
                                    justifyContent: 'center', 
                                    alignItems: 'center', 
                                    padding: '2rem', 
                                    zIndex: 20, 
                                    textAlign: 'center',
                                    border: '1px solid var(--color-danger)'
                                }}>
                                    <h3 style={{ color: 'var(--color-danger)', marginTop: 0 }}>Are you sure?</h3>
                                    <p style={{ fontSize: '0.95rem', marginBottom: '1.5rem' }}>
                                        This will remove <strong>{selectedParticipant.name}</strong> from their current family household and start a brand new household for them alone.
                                    </p>
                                    <div style={{ display: 'flex', gap: '1rem' }}>
                                        <button 
                                            type="button" 
                                            className="glass-button" 
                                            onClick={() => setShowingNewHouseholdConfirm(false)}
                                            style={{ minWidth: '100px' }}
                                        >
                                            Go Back
                                        </button>
                                        <button 
                                            type="submit" 
                                            className="glass-button" 
                                            style={{ minWidth: '100px', background: 'rgba(239, 68, 68, 0.2)', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                                        >
                                            Yes, Proceed
                                        </button>
                                    </div>
                                </div>
                            )}
                            <div style={{ position: 'relative', background: 'rgba(59, 130, 246, 0.05)', padding: '1rem', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                                <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>
                                    Search for Existing Household
                                </label>
                                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', marginTop: 0, marginBottom: '1rem' }}>
                                    If left blank, a new household will be created.
                                </p>
                                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        className="glass-input"
                                        value={householdSearch}
                                        onChange={e => { setHouseholdSearch(e.target.value); setHouseholdId(""); }}
                                        style={{ width: '100%', padding: '0.75rem' }}
                                        placeholder="Search households..."
                                    />
                                    {householdId && (
                                        <button
                                            type="button"
                                            onClick={() => { setHouseholdId(""); setHouseholdSearch(""); }}
                                            style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', padding: '0.5rem', fontSize: '0.9rem', whiteSpace: 'nowrap' }}
                                        >
                                            Clear
                                        </button>
                                    )}
                                </div>
                                {householdSearching && <div style={{ marginTop: '0.5rem', color: 'gray', fontSize: '0.8rem' }}>Searching...</div>}
                                {householdResults.length > 0 && !householdId && (
                                    <div style={{ position: 'absolute', top: '100%', left: 0, width: '100%', background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', zIndex: 10, maxHeight: '250px', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.3)', marginTop: '4px' }}>
                                        {householdResults.map(h => (
                                            <div
                                                key={h.id}
                                                onClick={() => {
                                                    setHouseholdId(h.id.toString());
                                                    setHouseholdSearch(h.name || `Household #${h.id}`);
                                                    setHouseholdResults([]);
                                                }}
                                                style={{ padding: '0.75rem', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.05)' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.05)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                <div style={{ fontWeight: 500 }}>{h.name || `Household #${h.id}`}</div>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
                                                    {h.participants.map((p: any) => p.name || p.email || 'Unnamed').join(', ') || 'Empty'}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                                <button type="button" className="glass-button" onClick={() => { setAssignModalOpen(false); setSelectedParticipant(null); setHouseholdSearch(""); setHouseholdId(""); setShowingNewHouseholdConfirm(false); }} disabled={assigning}>
                                    Cancel
                                </button>
                                {(!selectedParticipant?.household || selectedParticipant.household.participants.length > 1) && (
                                    <button 
                                        type="submit" 
                                        className="glass-button" 
                                        disabled={assigning} 
                                        style={{ background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)' }}
                                    >
                                        {assigning ? "Saving..." : (
                                            householdId ? "Add to Household" : (
                                                selectedParticipant?.household ? "Pull from household and start a new one" : "Create New Household"
                                            )
                                        )}
                                    </button>
                                )}
                                {selectedParticipant?.household && selectedParticipant.household.participants.length === 1 && householdId && (
                                    <button 
                                        type="submit" 
                                        className="glass-button" 
                                        disabled={assigning} 
                                        style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}
                                    >
                                        {assigning ? "Saving..." : "Change Household"}
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {editModalOpen && (
                <div 
                    onClick={(e) => {
                        if (e.target === e.currentTarget) {
                            setEditModalOpen(false);
                            setEditingParticipant(null);
                        }
                    }}
                    style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100, backdropFilter: 'blur(8px)' }}
                >
                    <div className="glass-container" style={{ padding: '2rem', width: '100%', maxWidth: '500px', background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(255, 255, 255, 0.2)' }}>
                        <h2 style={{ marginTop: 0 }}>Edit Participant</h2>
                        
                        <form onSubmit={handleEditParticipant}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Name</label>
                                    <input 
                                        type="text" 
                                        className="glass-input" 
                                        value={editForm.name}
                                        onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                        style={{ width: '100%', padding: '0.75rem' }}
                                        required
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Email Address</label>
                                    <input 
                                        type="email" 
                                        className="glass-input" 
                                        value={editForm.email}
                                        onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                                        style={{ width: '100%', padding: '0.75rem' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Phone Number</label>
                                    <input 
                                        type="tel" 
                                        className="glass-input" 
                                        value={editForm.phone}
                                        onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                                        placeholder="(555) 123-4567"
                                        style={{ width: '100%', padding: '0.75rem' }}
                                    />
                                </div>
                                {editingParticipant.household && (
                                    <div style={{ marginTop: '0.5rem' }}>
                                        <label style={{ display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>Household</label>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', background: 'rgba(255,255,255,0.05)', padding: '0.75rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                                            <span style={{ fontSize: '0.9rem' }}>{editingParticipant.household.name}</span>
                                            <button 
                                                type="button"
                                                className="glass-button" 
                                                onClick={() => { 
                                                    setEditModalOpen(false);
                                                    setEditingParticipant(null);
                                                    setSelectedParticipant(editingParticipant); 
                                                    setAssignModalOpen(true); 
                                                }}
                                                style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem', background: 'rgba(255, 255, 255, 0.1)', marginLeft: 'auto' }}
                                            >
                                                Edit Household
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem' }}>
                                <button type="button" className="glass-button" onClick={() => { setEditModalOpen(false); setEditingParticipant(null); }} disabled={savingDetails}>
                                    Cancel
                                </button>
                                <button type="submit" className="glass-button" disabled={savingDetails} style={{ background: 'rgba(59, 130, 246, 0.2)', borderColor: 'rgba(59, 130, 246, 0.4)' }}>
                                    {savingDetails ? "Saving..." : "Save Details"}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
