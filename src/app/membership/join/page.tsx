"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MembershipJoinPage() {
    const router = useRouter();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [householdId, setHouseholdId] = useState<number | null>(null);

    // Form State
    const [leads, setLeads] = useState([{ name: '', email: '', phone: '', isPrimary: true }]);
    const [children, setChildren] = useState([{ name: '', age: '' }]);
    const [emergencyContactName, setEmergencyContactName] = useState('');
    const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
    const [agreed, setAgreed] = useState(false);
    const [healthInsuranceInfo, setHealthInsuranceInfo] = useState('');

    const handleAddLead = () => setLeads([...leads, { name: '', email: '', phone: '', isPrimary: false }]);
    const handleAddChild = () => setChildren([...children, { name: '', age: '' }]);

    const submitInformation = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/membership', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    leads, 
                    children: children.filter(c => c.name), 
                    emergencyContactName, 
                    emergencyContactPhone,
                    healthInsuranceInfo
                })
            });
            const data = await res.json();
            if (data.success) {
                setHouseholdId(data.householdId);
                setStep(4); // Move to Payment Step
            } else {
                alert("Error submitting form: " + data.error);
            }
        } catch (error) {
            console.error(error);
            alert("Network error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto', animation: 'subtly-float 6s ease-in-out infinite' }}>
            <h1 className="text-gradient" style={{ fontSize: '2.5rem', marginBottom: '0.5rem', textAlign: 'center' }}>
                Join the Treehouse
            </h1>
            <p style={{ color: 'var(--color-text-muted)', textAlign: 'center', marginBottom: '2rem' }}>
                Step {step} of 5
            </p>

            <div className="glass-container">
                {step === 1 && (
                    <div className="fade-in">
                        <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>1. Household Information</h2>
                        
                        <div style={{ marginBottom: '2rem' }}>
                            <h3 style={{ color: 'var(--color-primary)' }}>Parents / Leads</h3>
                            {leads.map((lead, index) => (
                                <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
                                    <input 
                                        type="text" placeholder="Full Name" required
                                        value={lead.name} onChange={(e) => { const newLeads = [...leads]; newLeads[index].name = e.target.value; setLeads(newLeads); }}
                                        style={inputStyle}
                                    />
                                    <input 
                                        type="email" placeholder="Email" required
                                        value={lead.email} onChange={(e) => { const newLeads = [...leads]; newLeads[index].email = e.target.value; setLeads(newLeads); }}
                                        style={inputStyle}
                                    />
                                    <input 
                                        type="tel" placeholder="Phone" required
                                        value={lead.phone} onChange={(e) => { const newLeads = [...leads]; newLeads[index].phone = e.target.value; setLeads(newLeads); }}
                                        style={inputStyle}
                                    />
                                    <label style={{ fontSize: '0.85rem', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <input type="radio" name="primaryLead" checked={lead.isPrimary} onChange={() => {
                                            const newLeads = leads.map((l, i) => ({ ...l, isPrimary: i === index }));
                                            setLeads(newLeads);
                                        }} />
                                        Primary
                                    </label>
                                </div>
                            ))}
                            <button type="button" onClick={handleAddLead} className="glass-button" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>+ Add Parent</button>
                        </div>

                        <div style={{ marginBottom: '2rem' }}>
                            <h3 style={{ color: 'var(--color-primary)' }}>Children (Optional)</h3>
                            {children.map((child, index) => (
                                <div key={index} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                                    <input 
                                        type="text" placeholder="Child First Name" 
                                        value={child.name} onChange={(e) => { const newChildren = [...children]; newChildren[index].name = e.target.value; setChildren(newChildren); }}
                                        style={inputStyle}
                                    />
                                    <input 
                                        type="number" placeholder="Age" min="0" max="18"
                                        value={child.age} onChange={(e) => { const newChildren = [...children]; newChildren[index].age = e.target.value; setChildren(newChildren); }}
                                        style={inputStyle}
                                    />
                                </div>
                            ))}
                            <button type="button" onClick={handleAddChild} className="glass-button" style={{ fontSize: '0.85rem', padding: '0.5rem 1rem' }}>+ Add Child</button>
                        </div>

                        <div style={{ marginBottom: '2rem' }}>
                            <h3 style={{ color: 'var(--color-primary)' }}>Emergency Contact</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                <input 
                                    type="text" placeholder="Name" required
                                    value={emergencyContactName} onChange={(e) => setEmergencyContactName(e.target.value)}
                                    style={inputStyle}
                                />
                                <input 
                                    type="tel" placeholder="Phone" required
                                    value={emergencyContactPhone} onChange={(e) => setEmergencyContactPhone(e.target.value)}
                                    style={inputStyle}
                                />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button className="glass-button" onClick={() => setStep(2)}>Next Steps →</button>
                        </div>
                    </div>
                )}

                {step === 2 && (
                    <div className="fade-in">
                        <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>2. Membership Agreement</h2>
                        <div style={{ background: 'rgba(0,0,0,0.2)', padding: '1.5rem', borderRadius: '8px', height: '200px', overflowY: 'auto', marginBottom: '1.5rem', fontSize: '0.9rem', lineHeight: '1.6' }}>
                            <p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>
                            <br/>
                            <p>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</p>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2rem', cursor: 'pointer', fontSize: '1.1rem' }}>
                            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: '1.5rem', height: '1.5rem' }} />
                            <b>I agree to the Membership Terms and Conditions</b>
                        </label>

                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <button className="glass-button" onClick={() => setStep(1)}>← Back</button>
                            <button className="glass-button" disabled={!agreed} onClick={() => setStep(3)} style={{ opacity: agreed ? 1 : 0.5 }}>Proceed →</button>
                        </div>
                    </div>
                )}

                {step === 3 && (
                    <div className="fade-in">
                        <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>3. Health Insurance Information</h2>
                        <p style={{ color: 'var(--color-text-muted)', marginBottom: '1.5rem' }}>Please provide your primary household health insurance details for our records.</p>
                        
                        <textarea 
                            placeholder="Provider Name, Policy Number, Group ID..."
                            value={healthInsuranceInfo}
                            onChange={(e) => setHealthInsuranceInfo(e.target.value)}
                            style={{ ...inputStyle, minHeight: '120px', resize: 'vertical' }}
                            required
                        />

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '2rem' }}>
                            <button className="glass-button" onClick={() => setStep(2)}>← Back</button>
                            <button className="glass-button" onClick={submitInformation} disabled={loading || healthInsuranceInfo.length < 5}>
                                {loading ? 'Submitting...' : 'Submit & Proceed to Payment →'}
                            </button>
                        </div>
                    </div>
                )}

                {step === 4 && (
                    <div className="fade-in" style={{ textAlign: 'center' }}>
                        <h2 style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--glass-border)', paddingBottom: '0.5rem' }}>4. Membership Dues</h2>
                        <p style={{ marginBottom: '2rem', fontSize: '1.1rem' }}>Please complete your membership payment via Shopify.</p>
                        
                        <a 
                            href={`https://example-treehouse-store.myshopify.com/cart/12345:1?attributes[Membership_Household_ID]=${householdId}`} 
                            target="_blank" rel="noreferrer"
                            className="glass-button"
                            style={{ padding: '1rem 3rem', fontSize: '1.25rem', background: 'var(--color-primary)', border: 'none', color: 'white' }}
                        >
                            Complete Payment via Shopify Pay
                        </a>

                        <p style={{ marginTop: '1.5rem', color: 'var(--color-text-muted)', fontSize: '0.9rem' }}>
                            <i>Talk to the board sub-committee if alternative arrangements are desired.</i>
                        </p>

                        <div style={{ marginTop: '3rem' }}>
                            <button className="glass-button" onClick={() => setStep(5)}>I've Completed Payment →</button>
                        </div>
                    </div>
                )}

                {step === 5 && (
                    <div className="fade-in" style={{ textAlign: 'center' }}>
                        <h2 className="text-gradient" style={{ marginBottom: '1.5rem', fontSize: '2rem' }}>5. Final Step: Background Check</h2>
                        <div style={{ background: 'rgba(255,255,255,0.05)', padding: '2rem', borderRadius: '12px' }}>
                            <p style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Your application is almost complete!</p>
                            <p style={{ color: 'var(--color-text-muted)', marginBottom: '2rem' }}>
                                The Primary Household Lead will receive an email shortly with a link to complete the required external background check.
                            </p>
                            <div style={{ border: '1px solid var(--color-primary)', padding: '1rem', borderRadius: '8px', color: 'var(--color-primary)', display: 'inline-block' }}>
                                <b>Status: Pending Background Check</b>
                            </div>
                        </div>
                        <p style={{ marginTop: '2rem' }}>Once certified by the board, you will receive a congratulatory welcome email.</p>
                        <button className="glass-button" style={{ marginTop: '2rem' }} onClick={() => router.push('/')}>Return Home</button>
                    </div>
                )}
            </div>
            
            <style dangerouslySetInnerHTML={{__html: `
                .fade-in { animation: fadeIn 0.4s ease-in; }
                @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
            `}} />
        </div>
    );
}

const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.75rem 1rem',
    borderRadius: '8px',
    border: '1px solid var(--glass-border)',
    background: 'rgba(0,0,0,0.2)',
    color: '#fff',
    fontSize: '0.95rem',
    outline: 'none',
    boxSizing: 'border-box'
};
