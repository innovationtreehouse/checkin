"use client";
/* eslint-disable react-hooks/exhaustive-deps */

import { use, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import styles from '../../page.module.css';
import { formatDate } from '@/lib/time';

type ProgramDetail = {
    id: number;
    name: string;
    begin: string | null;
    end: string | null;
    leadMentorId: number | null;
    leadMentor?: { name: string | null; email: string } | null;
    participants: { participantId: number, status?: string }[];
    enrollmentStatus: string;
    memberPrice: number | null;
    nonMemberPrice: number | null;
    shopifyMemberVariantId: string | null;
    shopifyNonMemberVariantId: string | null;
    minAge: number | null;
    maxAge: number | null;
};

export default function ProgramEnrollmentPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const { data: session, status } = useSession();
    const router = useRouter();

    const [program, setProgram] = useState<ProgramDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [enrolling, setEnrolling] = useState(false);
    const [message, setMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [requiresOverride, setRequiresOverride] = useState(false);

    const [showEnrollmentSelection, setShowEnrollmentSelection] = useState(false);
    const [householdMembers, setHouseholdMembers] = useState<{ id: number; name: string | null; dob: string | null }[]>([]);
    const [selectedParticipantId, setSelectedParticipantId] = useState<number | null>(null);
    const [loadingHousehold, setLoadingHousehold] = useState(false);

    useEffect(() => {
        fetchProgram();
    }, [id]);

    const fetchProgram = async () => {
        try {
            const res = await fetch(`/api/programs/${id}`);
            if (res.ok) {
                const data = await res.json();
                setProgram(data);
            } else if (res.status === 404) {
                setMessage("Program not found.");
            } else {
                setMessage("Failed to load program details.");
            }
        } catch {
            setMessage("Network error.");
        } finally {
            setLoading(false);
        }
    };

    const startEnrollmentProcess = async () => {
        if (!session) {
            router.push('/');
            return;
        }
        setShowEnrollmentSelection(true);
        setLoadingHousehold(true);

        try {
            const currentUserId = (session.user as { id: number }).id;
            const res = await fetch(`/api/household`);
            if (res.ok) {
                const data = await res.json();
                if (data.household && data.household.participants) {
                    setHouseholdMembers(data.household.participants);
                    const me = data.household.participants.find((p: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => p.id === currentUserId);
                    if (me) setSelectedParticipantId(me.id);
                    else setSelectedParticipantId(data.household.participants[0]?.id || currentUserId);
                } else {
                    setHouseholdMembers([{ id: currentUserId, name: "Myself", dob: null }]);
                    setSelectedParticipantId(currentUserId);
                }
            } else {
                 setHouseholdMembers([{ id: currentUserId, name: "Myself", dob: null }]);
                 setSelectedParticipantId(currentUserId);
            }
        } catch {
             const currentUserId = (session.user as { id: number }).id;
             setHouseholdMembers([{ id: currentUserId, name: "Myself", dob: null }]);
             setSelectedParticipantId(currentUserId);
        } finally {
            setLoadingHousehold(false);
        }
    };

    const handleRequestPaymentPlan = async () => {
        if (!session || !selectedParticipantId) return router.push('/');
        
        setEnrolling(true);
        setMessage("");

        try {
            // First we enroll them (which defaults to PENDING)
            let res = await fetch(`/api/programs/${id}/participants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId: selectedParticipantId })
            });

            if (!res.ok) {
                const data = await res.json();
                setMessage(data.error || "Failed to start enrollment.");
                setEnrolling(false);
                return;
            }

            // Then we flag that they requested a payment plan
            res = await fetch(`/api/programs/${id}/request-payment-plan`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ participantId: selectedParticipantId })
            });

            if (res.ok) {
                setSuccessMessage("Requested! Please check your email for communication from the finance committee of the board.");
                fetchProgram();
            } else {
                setMessage("Enrolled as pending, but failed to alert the finance committee. Please email them directly.");
            }
        } catch {
             setMessage("Network error requesting payment plan.");
        } finally {
            setEnrolling(false);
        }
    };

    const handleEnroll = async (override = false) => {
        if (!session || !selectedParticipantId) {
            router.push('/');
            return;
        }

        const isPayingOnShopify = !override && (program?.memberPrice || program?.nonMemberPrice);

        setEnrolling(true);
        setMessage("");

        try {
            const res = await fetch(`/api/programs/${id}/participants`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    participantId: selectedParticipantId,
                    override
                })
            });

            if (res.ok) {
                if (isPayingOnShopify) {
                    setSuccessMessage("Redirecting to Shopify for secure payment...");
                    
                    // Check membership via household data (already fetched)
                    const householdRes = await fetch('/api/household');
                    let isMember = false;
                    if (householdRes.ok) {
                        const householdData = await householdRes.json();
                        isMember = householdData.household?.memberships?.some((m: { id?: number; email?: string; name?: string; participantId?: number; level?: string; status?: string; role?: string; type?: string; [key: string]: unknown }) => m.active) || false;
                    }

                    const variantId = isMember ? program.shopifyMemberVariantId : program.shopifyNonMemberVariantId;
                    
                    if (variantId) {
                        const storeDomain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
                        const checkoutUrl = `https://${storeDomain}/cart/${variantId}:1?attributes[CheckMeIn_Account_ID]=${selectedParticipantId}&attributes[Program_ID]=${id}`;
                        window.location.href = checkoutUrl;
                    } else {
                        setSuccessMessage("Enrolled! (Note: No pricing variant configured for this tier)");
                        fetchProgram();
                    }
                } else {
                    setSuccessMessage("Successfully enrolled!");
                    setRequiresOverride(false);
                    fetchProgram(); // refresh
                }
            } else {
                const data = await res.json();
                if (data.requiresOverride) {
                    setRequiresOverride(true);
                    setMessage(data.error);
                } else {
                    setMessage(data.error || "Failed to enroll in program.");
                }
            }
        } catch {
            setMessage("Network error during enrollment.");
        } finally {
            if (!isPayingOnShopify) setEnrolling(false);
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

    if (!program) return (
        <main className={styles.main}>
            <div className="glass-container animate-float">
                <h2>{message || "Not Found"}</h2>
                <button className="glass-button" onClick={() => router.push('/programs')}>Back to Directory</button>
            </div>
        </main>
    );

    return (
        <main className={styles.main}>
            <div className={`glass-container ${styles.heroContainer}`} style={{ maxWidth: '800px', width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ fontSize: '2.5rem', margin: 0 }}>{program.name}</h1>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        {(session && ((session.user as { sysadmin?: boolean, boardMember?: boolean, id: number })?.sysadmin || (session.user as { sysadmin?: boolean, boardMember?: boolean, id: number })?.boardMember || (session.user as { sysadmin?: boolean, boardMember?: boolean, id: number })?.id === program.leadMentorId)) && (
                            <button className="glass-button" onClick={() => router.push(`/admin/programs/${program.id}`)} style={{ padding: '0.5rem 1rem', background: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.4)', color: '#4ade80' }}>
                                Manage Program
                            </button>
                        )}
                        <button className="glass-button" onClick={() => router.push('/programs')} style={{ padding: '0.5rem 1rem' }}>
                            &larr; Back
                        </button>
                    </div>
                </div>

                <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px', marginBottom: '2rem' }}>
                    <h3 style={{ margin: '0 0 1rem 0', color: 'var(--color-text-muted)' }}>Details</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '1.1rem' }}>
                        {program.leadMentor && (
                            <div>
                                <strong>Lead Mentor:</strong> {program.leadMentor.name || 'Unnamed'}
                            </div>
                        )}
                        <div>
                            <strong>Starts:</strong> {program.begin ? formatDate(program.begin) : 'TBD'} <br /><br />
                            <strong>Ends:</strong> {program.end ? formatDate(program.end) : 'Ongoing'}
                        </div>
                        <div>
                            <strong>Enrollment:</strong> {
                                program.enrollmentStatus === 'OPEN' ? <span style={{ color: '#4ade80' }}>Open</span> :
                                program.enrollmentStatus === 'CLOSED' ? <span style={{ color: '#f87171' }}>Closed</span> :
                                program.enrollmentStatus === 'WHITELIST' ? <span style={{ color: '#eab308' }}>Invite Only</span> :
                                program.enrollmentStatus
                            }
                        </div>
                        {(program.memberPrice !== null || program.nonMemberPrice !== null) && (
                            <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                                {program.memberPrice !== null && <div><strong>Member Price:</strong> ${program.memberPrice}</div>}
                                {program.nonMemberPrice !== null && <div><strong>Non-Member Price:</strong> ${program.nonMemberPrice}</div>}
                                {(!program.memberPrice && !program.nonMemberPrice) && <div><strong>Cost:</strong> Free</div>}
                            </div>
                        )}
                    </div>
                </div>

                {message && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '8px', color: '#f87171' }}>
                        {message}
                    </div>
                )}

                {successMessage && (
                    <div style={{ marginBottom: '1.5rem', padding: '1rem', background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.3)', borderRadius: '8px', color: '#4ade80' }}>
                        {successMessage}
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: '3rem' }}>
                    {!showEnrollmentSelection ? (
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                            {session ? (
                                <button
                                    className="glass-button primary-button"
                                    onClick={startEnrollmentProcess}
                                    disabled={program.enrollmentStatus === 'CLOSED'}
                                    style={{ 
                                        padding: '1rem 3rem', 
                                        fontSize: '1.2rem', 
                                        background: program.enrollmentStatus === 'CLOSED' ? 'rgba(56, 189, 248, 0.05)' : 'rgba(56, 189, 248, 0.2)', 
                                        borderColor: program.enrollmentStatus === 'CLOSED' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(56, 189, 248, 0.5)',
                                        opacity: program.enrollmentStatus === 'CLOSED' ? 0.5 : 1,
                                        cursor: program.enrollmentStatus === 'CLOSED' ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    {program.enrollmentStatus === 'CLOSED' ? "Enrollment Closed" : "Enroll"}
                                </button>
                            ) : (
                                <>
                                    <button
                                        className="glass-button"
                                        onClick={() => router.push('/')}
                                        style={{ 
                                            padding: '1rem 2rem', 
                                            fontSize: '1.2rem', 
                                            background: 'rgba(59, 130, 246, 0.2)', 
                                            borderColor: 'rgba(59, 130, 246, 0.4)'
                                        }}
                                    >
                                        Log In To Enroll
                                    </button>
                                    <button
                                        className="glass-button primary-button"
                                        onClick={() => router.push(`/programs/${program.id}/register`)}
                                        disabled={program.enrollmentStatus === 'CLOSED'}
                                        style={{ 
                                            padding: '1rem 2rem', 
                                            fontSize: '1.2rem', 
                                            background: program.enrollmentStatus === 'CLOSED' ? 'rgba(34, 197, 94, 0.05)' : 'rgba(34, 197, 94, 0.2)', 
                                            borderColor: program.enrollmentStatus === 'CLOSED' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(34, 197, 94, 0.5)',
                                            opacity: program.enrollmentStatus === 'CLOSED' ? 0.5 : 1,
                                            cursor: program.enrollmentStatus === 'CLOSED' ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        {program.enrollmentStatus === 'CLOSED' ? "Registration Closed" : "Register (New User)"}
                                    </button>
                                </>
                            )}
                        </div>
                    ) : (
                        <div style={{ width: '100%', maxWidth: '500px', background: 'rgba(0,0,0,0.2)', padding: '2rem', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)' }}>
                            <h3 style={{ margin: '0 0 1.5rem 0' }}>Which of your household wants to enroll?</h3>
                            
                            {loadingHousehold ? (
                                <p style={{ color: 'var(--color-text-muted)', textAlign: 'center' }}>Loading household...</p>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
                                    {householdMembers.map(member => {
                                        const alreadyEnrolled = program.participants.some(p => p.participantId === member.id);
                                        
                                        let ageError: string | null = null;
                                        if (program.minAge !== null || program.maxAge !== null) {
                                            if (!member.dob) {
                                                ageError = "DOB missing";
                                            } else {
                                                const ageDifMs = Date.now() - new Date(member.dob).getTime();
                                                const ageDate = new Date(ageDifMs);
                                                const age = Math.abs(ageDate.getUTCFullYear() - 1970);
                                                if (program.minAge !== null && age < program.minAge) ageError = "Too young";
                                                if (program.maxAge !== null && age > program.maxAge) ageError = "Too old";
                                            }
                                        }

                                        const disabled = alreadyEnrolled || ageError !== null;

                                        return (
                                            <label key={member.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1rem', background: selectedParticipantId === member.id && !disabled ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255,255,255,0.05)', border: `1px solid ${selectedParticipantId === member.id && !disabled ? 'rgba(56, 189, 248, 0.5)' : 'transparent'}`, borderRadius: '8px', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, transition: 'all 0.2s' }}>
                                                <input 
                                                    type="radio" 
                                                    name="enrollMember" 
                                                    value={member.id} 
                                                    checked={selectedParticipantId === member.id}
                                                    onChange={() => { if(!disabled) setSelectedParticipantId(member.id) }}
                                                    style={{ width: '1.2rem', height: '1.2rem', cursor: disabled ? 'not-allowed' : 'pointer' }}
                                                    disabled={disabled}
                                                />
                                                <span style={{ fontSize: '1.1rem', fontWeight: selectedParticipantId === member.id ? 'bold' : 'normal' }}>
                                                    {member.name || 'Unnamed Participant'}
                                                </span>
                                                {alreadyEnrolled && (
                                                    <span style={{ fontSize: '0.85rem', color: '#4ade80', marginLeft: 'auto' }}>(Already Enrolled)</span>
                                                )}
                                                {!alreadyEnrolled && ageError && (
                                                    <span style={{ fontSize: '0.85rem', color: '#f87171', marginLeft: 'auto' }}>({ageError})</span>
                                                )}
                                            </label>
                                        );
                                    })}
                                </div>
                            )}

                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                                <button
                                    className="glass-button primary-button"
                                    onClick={() => handleEnroll(false)}
                                    disabled={enrolling || !selectedParticipantId || program.participants.some(p => p.participantId === selectedParticipantId) || loadingHousehold}
                                    style={{ 
                                        width: '100%',
                                        padding: '1rem', 
                                        fontSize: '1.2rem', 
                                        background: 'rgba(56, 189, 248, 0.2)', 
                                        borderColor: 'rgba(56, 189, 248, 0.5)',
                                    }}
                                >
                                    {enrolling ? "Processing..." : (program.memberPrice || program.nonMemberPrice) ? "Pay on Shopify" : "Complete Enrollment"}
                                </button>
                                
                                {(program.memberPrice || program.nonMemberPrice) && program.enrollmentStatus !== 'CLOSED' && (
                                    <button
                                        onClick={handleRequestPaymentPlan}
                                        disabled={enrolling || !selectedParticipantId || program.participants.some(p => p.participantId === selectedParticipantId) || loadingHousehold}
                                        style={{ 
                                            background: 'none', 
                                            border: 'none', 
                                            color: 'var(--color-primary)', 
                                            textDecoration: 'underline', 
                                            cursor: 'pointer',
                                            fontSize: '0.9rem'
                                        }}
                                    >
                                        request a payment plan from the finance committee of the board
                                    </button>
                                )}
                            </div>

                            {requiresOverride && (
                                <div style={{ marginTop: '1.5rem', padding: '1.5rem', borderRadius: '8px', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                                    <p style={{ color: '#eab308', fontWeight: 'bold', marginBottom: '1rem' }}>Warning: Enrollment rules not met.</p>
                                    <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                                        As an Admin or Lead Mentor, you can bypass this restriction. Are you sure you want to force enroll?
                                    </p>
                                    <button
                                        className="glass-button"
                                        onClick={() => handleEnroll(true)}
                                        style={{ background: 'rgba(234, 179, 8, 0.2)', color: '#eab308', borderColor: 'rgba(234, 179, 8, 0.5)', width: '100%' }}
                                    >
                                        Force Enroll (Override)
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </main>
    );
}
