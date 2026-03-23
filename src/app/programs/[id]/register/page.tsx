"use client";

import { use, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import styles from '../../../page.module.css';

const SectionHeader = ({ title, description }: { title: string, description?: string }) => (
    <div style={{ marginBottom: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '0.5rem' }}>
        <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--color-primary-light)' }}>{title}</h3>
        {description && <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>{description}</p>}
    </div>
);

const FormGroup = ({ label, children }: { label: string, children: ReactNode }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', flex: 1 }}>
        <label style={{ fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>{label}</label>
        {children}
    </div>
);
export default function PublicRegistrationPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const router = useRouter();

    const [program, setProgram] = useState<any>(null);
    const [loadingProgram, setLoadingProgram] = useState(true);
    const [programError, setProgramError] = useState("");

    const [parents, setParents] = useState([{ name: '', email: '', phone: '' }]);
    const [emergencyContact, setEmergencyContact] = useState({ name: '', phone: '' });
    const [participants, setParticipants] = useState<{name: string; dob: string}[]>([{ name: '', dob: '' }]);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
        const fetchProgram = async () => {
            try {
                const res = await fetch(`/api/programs/${id}`);
                if (res.ok) {
                    const data = await res.json();
                    setProgram(data);
                    if (data.enrollmentStatus === 'CLOSED') {
                        setProgramError("Registration is currently closed for this program.");
                    } else if (data.maxParticipants !== null && data.participants?.length >= data.maxParticipants) {
                        setProgramError("This program is currently full.");
                    }
                } else {
                    setProgramError("Failed to load program details.");
                }
            } catch {
                setProgramError("Network error.");
            } finally {
                setLoadingProgram(false);
            }
        };
        fetchProgram();
    }, [id]);

    const handleAddParent = () => {
        if (parents.length < 2) {
            setParents([...parents, { name: '', email: '', phone: '' }]);
        }
    };

    const handleRemoveParent = (index: number) => {
        setParents(parents.filter((_, i) => i !== index));
    };

    const handleParentChange = (index: number, field: string, value: string) => {
        const newParents = [...parents];
        newParents[index] = { ...newParents[index], [field]: value };
        setParents(newParents);
    };

    const handleAddParticipant = () => {
        setParticipants([...participants, { name: '', dob: '' }]);
    };

    const handleRemoveParticipant = (index: number) => {
        if (participants.length > 1) {
            setParticipants(participants.filter((_, i) => i !== index));
        }
    };

    const handleParticipantChange = (index: number, field: string, value: string) => {
        const newParticipants = [...participants];
        newParticipants[index] = { ...newParticipants[index], [field]: value };
        setParticipants(newParticipants);
    };



    const validateForm = () => {
        setError("");
        if (!parents[0].name || !parents[0].email || !parents[0].phone) {
            setError("Primary parent/guardian information is required.");
            return false;
        }
        if (!emergencyContact.name || !emergencyContact.phone) {
            setError("Emergency contact is required.");
            return false;
        }
        if (parents.some(p => p.phone && p.phone.replace(/\\D/g, '') === emergencyContact.phone.replace(/\\D/g, ''))) {
            setError("Emergency contact phone must be different from parent/guardian phone numbers.");
            return false;
        }
        for (let i = 0; i < participants.length; i++) {
            if (!participants[i].name) {
                setError(`Participant ${i + 1} is missing a name.`);
                return false;
            }
            if (!participants[i].dob && (program?.minAge !== null || program?.maxAge !== null)) {
                // Check if they match a parent, if so, skip DOB requirement
                const isMatchingParent = parents.some(parent => parent.name.toLowerCase().trim() === participants[i].name.toLowerCase().trim());
                if (!isMatchingParent) {
                    setError(`Participant ${i + 1} needs a Date of Birth for age verification.`);
                    return false;
                }
            }
        }
        return true;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!validateForm()) return;

        setSubmitting(true);
        setError("");
        
        try {
            const res = await fetch(`/api/programs/${id}/public-register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parents, emergencyContact, participants })
            });

            const data = await res.json();
            if (res.ok) {
                if (data.checkoutUrl) {
                    setSuccess("Registration started! Redirecting you to checkout...");
                    window.location.href = data.checkoutUrl;
                } else {
                    setSuccess("Registration successful! Check your email for confirmation.");
                    setTimeout(() => router.push(`/programs/${id}`), 3000);
                }
            } else {
                setError(data.error || "Failed to register.");
                setSubmitting(false);
            }
        } catch {
            setError("Network error occurred.");
            setSubmitting(false);
        }
    };

    if (loadingProgram) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float" style={{ maxWidth: '600px', width: '100%', margin: '2rem auto' }}>
                    <h2 style={{ textAlign: 'center' }}>Loading program details...</h2>
                </div>
            </main>
        );
    }

    if (programError || !program) {
        return (
            <main className={styles.main}>
                <div className="glass-container animate-float" style={{ maxWidth: '600px', width: '100%', margin: '2rem auto' }}>
                    <h2 style={{ color: '#f87171', textAlign: 'center' }}>{programError || "Program Not Found"}</h2>
                    <div style={{ textAlign: 'center', marginTop: '2rem' }}>
                        <button className="glass-button" onClick={() => router.push(`/programs/${id}`)}>Go Back</button>
                    </div>
                </div>
            </main>
        );
    }



    const inputStyle = {
        padding: '0.75rem 1rem',
        borderRadius: '8px',
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(0,0,0,0.2)',
        color: 'white',
        fontSize: '1rem',
        width: '100%',
        boxSizing: 'border-box' as const
    };

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '800px', width: '100%', margin: '2rem auto' }}>
                <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: '0 0 0.5rem 0' }}>Register for Program</h1>
                    <h2 style={{ margin: 0, color: 'var(--color-text-muted)', fontWeight: 'normal' }}>{program.name}</h2>
                    {program.nonMemberPrice !== null && (
                        <p style={{ marginTop: '0.5rem', fontSize: '1.2rem', color: '#4ade80' }}>
                            Cost: ${program.nonMemberPrice} {participants.length > 1 ? `× ${participants.length}` : ''}
                        </p>
                    )}
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                    
                    {/* Parents Section */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '2rem', borderRadius: '12px' }}>
                        <SectionHeader title="Family Information" description="Every account needs at least one primary adult/guardian." />
                        
                        {parents.map((parent, index) => (
                            <div key={index} style={{ marginBottom: index === 0 ? '0' : '1.5rem', border: index > 0 ? '1px dashed rgba(255,255,255,0.2)' : 'none', padding: index > 0 ? '1rem' : '0', borderRadius: '8px', position: 'relative' }}>
                                {index > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveParent(index)}
                                        style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(239, 68, 68, 0.2)', border: 'none', color: '#fca5a5', padding: '0.2rem 0.6rem', borderRadius: '4px', cursor: 'pointer' }}
                                    >
                                        Remove
                                    </button>
                                )}
                                <h4 style={{ margin: '0 0 1rem 0' }}>{index === 0 ? 'Primary Guardian' : 'Secondary Guardian (Optional)'}</h4>
                                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                    <FormGroup label="Full Name">
                                        <input required={index === 0} style={inputStyle} type="text" value={parent.name} onChange={e => handleParentChange(index, 'name', e.target.value)} placeholder="Jane Doe" />
                                    </FormGroup>
                                    <FormGroup label="Email Address">
                                        <input required={index === 0} style={inputStyle} type="email" value={parent.email} onChange={e => handleParentChange(index, 'email', e.target.value)} placeholder="jane@example.com" />
                                    </FormGroup>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                    <FormGroup label="Phone Number">
                                        <input required={index === 0} style={inputStyle} type="tel" value={parent.phone} onChange={e => handleParentChange(index, 'phone', e.target.value)} placeholder="(555) 123-4567" />
                                    </FormGroup>
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', marginBottom: '1rem' }}>
                                        {/* Blank flex space to match layout */}
                                    </div>
                                </div>
                            </div>
                        ))}
                        
                        {parents.length < 2 && (
                            <button type="button" onClick={handleAddParent} className="glass-button" style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
                                + Add Secondary Guardian
                            </button>
                        )}
                    </div>

                    {/* Emergency Contact */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '2rem', borderRadius: '12px' }}>
                        <SectionHeader title="Emergency Contact" description="Someone outside the immediate household we can call." />
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                            <FormGroup label="Contact Name">
                                <input required style={inputStyle} type="text" value={emergencyContact.name} onChange={e => setEmergencyContact({ ...emergencyContact, name: e.target.value })} placeholder="John Smith" />
                            </FormGroup>
                            <FormGroup label="Contact Phone">
                                <input required style={inputStyle} type="tel" value={emergencyContact.phone} onChange={e => setEmergencyContact({ ...emergencyContact, phone: e.target.value })} placeholder="(555) 987-6543" />
                            </FormGroup>
                        </div>
                    </div>

                    {/* Participants */}
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: '2rem', borderRadius: '12px' }}>
                        <SectionHeader title="Program Participants" description="Who is attending this program?" />
                        
                        {participants.map((p, index) => (
                            <div key={index} style={{ marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.1)', padding: '1.5rem', borderRadius: '8px', position: 'relative', background: 'rgba(255,255,255,0.02)' }}>
                                {participants.length > 1 && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveParticipant(index)}
                                        style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(239, 68, 68, 0.2)', border: 'none', color: '#fca5a5', padding: '0.2rem 0.6rem', borderRadius: '4px', cursor: 'pointer' }}
                                    >
                                        Remove
                                    </button>
                                )}
                                <h4 style={{ margin: '0 0 1rem 0' }}>Participant {index + 1}</h4>
                                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                    <FormGroup label="Full Name">
                                        <input 
                                            required 
                                            style={inputStyle} 
                                            type="text" 
                                            value={p.name} 
                                            onChange={e => handleParticipantChange(index, 'name', e.target.value)} 
                                            placeholder="Child or Adult Name" 
                                        />
                                    </FormGroup>
                                    <FormGroup label="Date of Birth (Optional for Adults)">
                                        <input 
                                            required={!parents.some(parent => parent.name.toLowerCase().trim() === p.name.toLowerCase().trim()) && (program?.minAge !== null || program?.maxAge !== null)} 
                                            style={inputStyle} 
                                            type="date" 
                                            value={p.dob} 
                                            onChange={e => handleParticipantChange(index, 'dob', e.target.value)} 
                                        />
                                    </FormGroup>
                                </div>
                            </div>
                        ))}
                        
                        <button type="button" onClick={handleAddParticipant} className="glass-button" style={{ marginTop: '0.5rem', background: 'rgba(255,255,255,0.05)' }}>
                            + Add Another Participant
                        </button>
                    </div>

                    {error && (
                        <div style={{ padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#f87171' }}>
                            {error}
                        </div>
                    )}

                    {success && (
                        <div style={{ padding: '1rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', color: '#4ade80' }}>
                            {success}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', marginTop: '1rem' }}>
                        <button type="button" className="glass-button" onClick={() => router.push(`/programs/${id}`)} disabled={submitting}>
                            Cancel
                        </button>
                        <button 
                            type="submit" 
                            className="glass-button primary-button" 
                            disabled={submitting}
                            style={{ 
                                padding: '1rem 3rem', 
                                fontSize: '1.2rem',
                                background: 'rgba(56, 189, 248, 0.2)',
                                borderColor: 'rgba(56, 189, 248, 0.5)'
                            }}
                        >
                            {submitting ? "Processing..." : (program.nonMemberPrice !== null ? "Pay & Register via Shopify" : "Complete Registration")}
                        </button>
                    </div>
                </form>
            </div>
        </main>
    );
}
