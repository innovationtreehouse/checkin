"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import type { MembershipProcessStatus, MembershipStatus } from "@/generated/prisma/client";
import MembershipFlowStepper from "@/components/MembershipFlowStepper";

interface PersonPrefill {
    id: number;
    name: string | null;
    email: string | null;
    dob: string | null;
    allergies: string | null;
}

interface ExternalStatus {
    contractSigned: boolean;
    bgConsented: boolean;
    deepLinkUrl: string | null;
}

interface IntakeState {
    hasHousehold: boolean;
    membershipStatus: MembershipStatus | null;
    process: { id: number; kind: string; status: MembershipProcessStatus } | null;
    external: ExternalStatus | null;
    prefill: {
        household: { name: string | null; address: string | null; emergencyContactName: string | null; emergencyContactPhone: string | null } | null;
        primaryParent: PersonPrefill | null;
        secondaryParent: PersonPrefill | null;
        children: PersonPrefill[];
    };
}

interface ChildForm {
    id?: number;
    name: string;
    email: string;
    dob: string;
    allergies: string;
}

function ExternalTask({ done, title, doneText, children }: { done: boolean; title: string; doneText: string; children: React.ReactNode }) {
    return (
        <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: "12px", padding: "1.25rem", display: "flex", gap: "0.9rem", alignItems: "flex-start", background: done ? "rgba(34,197,94,0.08)" : "transparent" }}>
            <span aria-hidden style={{ width: "26px", height: "26px", borderRadius: "50%", background: done ? "#4ade80" : "rgba(255,255,255,0.15)", color: "#0f172a", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, flexShrink: 0 }}>
                {done ? "✓" : "•"}
            </span>
            <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: "0.4rem" }}>{title}</div>
                {done ? <p style={{ margin: 0, color: "#86efac" }}>{doneText}</p> : children}
            </div>
        </div>
    );
}

export default function MembershipPage() {
    const { data: session, status: sessionStatus } = useSession();

    const [state, setState] = useState<IntakeState | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);

    // Intake form fields
    const [address, setAddress] = useState("");
    const [emName, setEmName] = useState("");
    const [emPhone, setEmPhone] = useState("");
    const [primaryName, setPrimaryName] = useState("");
    const [primaryDob, setPrimaryDob] = useState("");
    const [primaryAllergies, setPrimaryAllergies] = useState("");
    const [hasSecondary, setHasSecondary] = useState(false);
    const [secondaryId, setSecondaryId] = useState<number | undefined>(undefined);
    const [secondaryName, setSecondaryName] = useState("");
    const [secondaryEmail, setSecondaryEmail] = useState("");
    const [secondaryDob, setSecondaryDob] = useState("");
    const [secondaryAllergies, setSecondaryAllergies] = useState("");
    const [children, setChildren] = useState<ChildForm[]>([]);
    const [payment, setPayment] = useState<{ amountCents: number; invoiceUrl: string | null } | null>(null);

    const hydrate = useCallback((s: IntakeState) => {
        setState(s);
        const h = s.prefill.household;
        setAddress(h?.address ?? "");
        setEmName(h?.emergencyContactName ?? "");
        setEmPhone(h?.emergencyContactPhone ?? "");
        const p = s.prefill.primaryParent;
        setPrimaryName(p?.name ?? "");
        setPrimaryDob(p?.dob ?? "");
        setPrimaryAllergies(p?.allergies ?? "");
        const sec = s.prefill.secondaryParent;
        if (sec) {
            setHasSecondary(true);
            setSecondaryId(sec.id);
            setSecondaryName(sec.name ?? "");
            setSecondaryEmail(sec.email ?? "");
            setSecondaryDob(sec.dob ?? "");
            setSecondaryAllergies(sec.allergies ?? "");
        }
        setChildren(
            s.prefill.children.map((c) => ({
                id: c.id,
                name: c.name ?? "",
                email: c.email ?? "",
                dob: c.dob ?? "",
                allergies: c.allergies ?? "",
            }))
        );
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch("/api/membership");
            if (res.ok) hydrate(await res.json());
        } catch {
            /* shown via empty state */
        } finally {
            setLoading(false);
        }
    }, [hydrate]);

    useEffect(() => {
        if (sessionStatus === "authenticated") load();
        else if (sessionStatus === "unauthenticated") setLoading(false);
    }, [sessionStatus, load]);

    // When awaiting payment, fetch (and lazily create) the Shopify invoice link.
    useEffect(() => {
        if (state?.process?.status !== "PENDING_PAYMENT") return;
        let cancelled = false;
        fetch("/api/membership/payment")
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => { if (!cancelled && data) setPayment(data); })
            .catch(() => { /* shown as link-unavailable */ });
        return () => { cancelled = true; };
    }, [state?.process?.status]);

    const flash = (msg: string, error = false) => {
        setMessage(msg);
        setIsError(error);
    };

    const startApplication = async () => {
        setSaving(true);
        flash("");
        try {
            const res = await fetch("/api/membership", { method: "POST" });
            const data = await res.json();
            if (res.ok) hydrate(data.state);
            else flash(data.error || "Could not start your application.", true);
        } catch {
            flash("Network error.", true);
        } finally {
            setSaving(false);
        }
    };

    const buildPayload = () => ({
        household: { address, emergencyContactName: emName, emergencyContactPhone: emPhone },
        primaryParent: { name: primaryName, dob: primaryDob || null, allergies: primaryAllergies || null },
        secondaryParent: hasSecondary
            ? { id: secondaryId, name: secondaryName, email: secondaryEmail || undefined, dob: secondaryDob || null, allergies: secondaryAllergies || null }
            : null,
        children: children
            .filter((c) => c.name.trim())
            .map((c) => ({ id: c.id, name: c.name, email: c.email || null, dob: c.dob || null, allergies: c.allergies || null })),
    });

    const save = async () => {
        setSaving(true);
        flash("");
        try {
            const res = await fetch("/api/membership/intake", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildPayload()),
            });
            const data = await res.json();
            if (res.ok) {
                hydrate(data.state);
                flash("Progress saved.");
            } else flash(data.error || "Could not save.", true);
        } catch {
            flash("Network error.", true);
        } finally {
            setSaving(false);
        }
    };

    const submit = async () => {
        setSaving(true);
        flash("");
        try {
            // Persist latest edits first, then advance.
            const saveRes = await fetch("/api/membership/intake", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(buildPayload()),
            });
            if (!saveRes.ok) {
                const d = await saveRes.json();
                flash(d.error || "Could not save.", true);
                return;
            }
            const res = await fetch("/api/membership/intake/submit", { method: "POST" });
            const data = await res.json();
            if (res.ok) {
                hydrate(data.state);
                flash("Submitted! Next: sign your contract and consent to a background check.");
            } else flash(data.error || "Could not submit.", true);
        } catch {
            flash("Network error.", true);
        } finally {
            setSaving(false);
        }
    };

    const renew = async () => {
        setSaving(true);
        flash("");
        try {
            const res = await fetch("/api/membership/renew", { method: "POST" });
            const data = await res.json();
            if (res.ok) { await load(); flash("Renewal started."); }
            else flash(data.error || "Could not start renewal.", true);
        } catch {
            flash("Network error.", true);
        } finally {
            setSaving(false);
        }
    };

    const addChild = () => setChildren((c) => [...c, { name: "", email: "", dob: "", allergies: "" }]);
    const updateChild = (i: number, field: keyof ChildForm, value: string) =>
        setChildren((c) => c.map((child, idx) => (idx === i ? { ...child, [field]: value } : child)));
    const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i));

    if (sessionStatus === "loading" || loading) {
        return <main style={{ padding: "2rem", textAlign: "center", color: "var(--color-text-muted)" }}>Loading…</main>;
    }

    if (!session?.user) {
        return (
            <main style={{ padding: "2rem", textAlign: "center" }}>
                <div className="glass-container" style={{ maxWidth: "480px", margin: "0 auto", padding: "2rem" }}>
                    <h1>Join the Treehouse</h1>
                    <p style={{ color: "var(--color-text-muted)" }}>Please sign in to start your membership application.</p>
                    <Link href="/" className="glass-button">Go to sign in</Link>
                </div>
            </main>
        );
    }

    const inStatus = state?.process?.status ?? null;
    const isIntake = inStatus === "INTAKE";
    const isActive = state?.membershipStatus === "ACTIVE";
    const isRenewal = state?.process?.kind === "RENEWAL";
    const labelStyle: React.CSSProperties = { display: "block", marginBottom: "0.35rem", fontWeight: 500 };
    const fieldStyle: React.CSSProperties = { width: "100%", padding: "0.6rem" };

    return (
        <main style={{ maxWidth: "1100px", margin: "0 auto", padding: "2rem 1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "2rem" }}>
                <h1 className="text-gradient" style={{ margin: 0 }}>Treehouse Membership</h1>
                <Link href="/" className="glass-button" style={{ textDecoration: "none", color: "white" }}>&larr; Home</Link>
            </div>

            {message && (
                <div style={{ marginBottom: "1.5rem", padding: "1rem", background: isError ? "rgba(239,68,68,0.1)" : "rgba(34,197,94,0.1)", border: `1px solid ${isError ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`, borderRadius: "8px", color: isError ? "#f87171" : "#4ade80" }}>
                    {message}
                </div>
            )}

            {!state?.process ? (
                isActive ? (
                    <div className="glass-container" style={{ padding: "2rem" }}>
                        <h2 style={{ marginTop: 0 }}>You&apos;re a member 🎉</h2>
                        <p style={{ color: "var(--color-text-muted)" }}>Your household membership is active. Thank you for being part of the Treehouse!</p>
                    </div>
                ) : (
                    <div className="glass-container" style={{ padding: "2rem", maxWidth: "640px" }}>
                        <h2 style={{ marginTop: 0 }}>Become a member</h2>
                        <p style={{ color: "var(--color-text-muted)" }}>
                            Membership is for your whole household. We&apos;ll collect some information about your family, then walk you through signing a
                            contract, a background check, and payment. You can stop and resume anytime.
                        </p>
                        <button className="glass-button" disabled={saving} onClick={startApplication} style={{ background: "rgba(59,130,246,0.3)", borderColor: "rgba(59,130,246,0.5)", padding: "0.9rem 1.4rem", marginTop: "0.5rem" }}>
                            {saving ? "Starting…" : "Start application"}
                        </button>
                    </div>
                )
            ) : isRenewal && inStatus === "PENDING_RENEWAL" ? (
                <div className="glass-container" style={{ padding: "2rem", maxWidth: "640px" }}>
                    <h2 style={{ marginTop: 0 }}>Time to renew</h2>
                    <p style={{ color: "var(--color-text-muted)" }}>
                        Your household membership is up for renewal. You&apos;re still an active member — confirm below to continue for another year.
                        No contract to re-sign; we&apos;ll only re-check a background if it&apos;s been more than three years.
                    </p>
                    <button className="glass-button" disabled={saving} onClick={renew} style={{ background: "rgba(34,197,94,0.25)", borderColor: "rgba(34,197,94,0.5)", padding: "0.9rem 1.4rem", marginTop: "0.5rem" }}>
                        {saving ? "Starting…" : "Renew now"}
                    </button>
                </div>
            ) : isRenewal && inStatus === "RENEWAL_PENDING_BG" ? (
                <div className="glass-container" style={{ padding: "2rem", maxWidth: "640px" }}>
                    <h2 style={{ marginTop: 0 }}>Renewal in progress</h2>
                    <p style={{ color: "var(--color-text-muted)" }}>
                        We&apos;re re-confirming your household&apos;s background check (it&apos;s been over three years). You&apos;ll be able to pay once that&apos;s done.
                        Your membership stays active in the meantime.
                    </p>
                </div>
            ) : (
                <div style={{ display: "flex", gap: "2rem", alignItems: "flex-start", flexWrap: "wrap" }}>
                    {!isRenewal && (
                        <div style={{ flex: "0 0 auto" }}>
                            <MembershipFlowStepper currentStatus={inStatus} />
                        </div>
                    )}

                    <div style={{ flex: "1 1 420px", minWidth: "320px" }}>
                        {isIntake ? (
                            <div className="glass-container" style={{ padding: "1.75rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                                <section>
                                    <h2 style={{ marginTop: 0 }}>Your household</h2>
                                    <label style={labelStyle}>Home address</label>
                                    <input className="glass-input" style={fieldStyle} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St, City, State ZIP" />
                                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem" }}>
                                        <div style={{ flex: "1 1 200px" }}>
                                            <label style={labelStyle}>Emergency contact name</label>
                                            <input className="glass-input" style={fieldStyle} value={emName} onChange={(e) => setEmName(e.target.value)} />
                                        </div>
                                        <div style={{ flex: "1 1 200px" }}>
                                            <label style={labelStyle}>Emergency contact phone</label>
                                            <input className="glass-input" style={fieldStyle} value={emPhone} onChange={(e) => setEmPhone(e.target.value)} />
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <h2 style={{ marginBottom: "0.75rem" }}>Primary parent / guardian</h2>
                                    <label style={labelStyle}>Full name</label>
                                    <input className="glass-input" style={fieldStyle} value={primaryName} onChange={(e) => setPrimaryName(e.target.value)} />
                                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem" }}>
                                        <div style={{ flex: "1 1 200px" }}>
                                            <label style={labelStyle}>Date of birth</label>
                                            <input type="date" className="glass-input" style={fieldStyle} value={primaryDob} onChange={(e) => setPrimaryDob(e.target.value)} />
                                        </div>
                                        <div style={{ flex: "1 1 200px" }}>
                                            <label style={labelStyle}>Allergies (optional)</label>
                                            <input className="glass-input" style={fieldStyle} value={primaryAllergies} onChange={(e) => setPrimaryAllergies(e.target.value)} />
                                        </div>
                                    </div>
                                </section>

                                <section>
                                    <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                                        <input type="checkbox" checked={hasSecondary} onChange={(e) => setHasSecondary(e.target.checked)} />
                                        <span style={{ fontWeight: 600 }}>Add a second parent / guardian</span>
                                    </label>
                                    {hasSecondary && (
                                        <div style={{ marginTop: "0.75rem" }}>
                                            <label style={labelStyle}>Full name</label>
                                            <input className="glass-input" style={fieldStyle} value={secondaryName} onChange={(e) => setSecondaryName(e.target.value)} />
                                            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "1rem" }}>
                                                <div style={{ flex: "1 1 200px" }}>
                                                    <label style={labelStyle}>Email (optional)</label>
                                                    <input type="email" className="glass-input" style={fieldStyle} value={secondaryEmail} onChange={(e) => setSecondaryEmail(e.target.value)} />
                                                </div>
                                                <div style={{ flex: "1 1 200px" }}>
                                                    <label style={labelStyle}>Date of birth</label>
                                                    <input type="date" className="glass-input" style={fieldStyle} value={secondaryDob} onChange={(e) => setSecondaryDob(e.target.value)} />
                                                </div>
                                            </div>
                                            <label style={{ ...labelStyle, marginTop: "1rem" }}>Allergies (optional)</label>
                                            <input className="glass-input" style={fieldStyle} value={secondaryAllergies} onChange={(e) => setSecondaryAllergies(e.target.value)} />
                                        </div>
                                    )}
                                </section>

                                <section>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                                        <h2 style={{ margin: 0 }}>Children</h2>
                                        <button type="button" className="glass-button" onClick={addChild} style={{ padding: "0.4rem 0.9rem" }}>+ Add child</button>
                                    </div>
                                    {children.length === 0 && <p style={{ color: "var(--color-text-muted)", margin: 0 }}>No children added yet.</p>}
                                    {children.map((child, i) => (
                                        <div key={child.id ?? `new-${i}`} style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", padding: "1rem", marginBottom: "0.75rem" }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                                                <strong>Child {i + 1}</strong>
                                                <button type="button" onClick={() => removeChild(i)} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>Remove</button>
                                            </div>
                                            <label style={labelStyle}>Full name</label>
                                            <input className="glass-input" style={fieldStyle} value={child.name} onChange={(e) => updateChild(i, "name", e.target.value)} />
                                            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
                                                <div style={{ flex: "1 1 160px" }}>
                                                    <label style={labelStyle}>Date of birth</label>
                                                    <input type="date" className="glass-input" style={fieldStyle} value={child.dob} onChange={(e) => updateChild(i, "dob", e.target.value)} />
                                                </div>
                                                <div style={{ flex: "1 1 160px" }}>
                                                    <label style={labelStyle}>Email (optional)</label>
                                                    <input type="email" className="glass-input" style={fieldStyle} value={child.email} onChange={(e) => updateChild(i, "email", e.target.value)} />
                                                </div>
                                            </div>
                                            <label style={{ ...labelStyle, marginTop: "0.75rem" }}>Allergies (optional)</label>
                                            <input className="glass-input" style={fieldStyle} value={child.allergies} onChange={(e) => updateChild(i, "allergies", e.target.value)} />
                                        </div>
                                    ))}
                                </section>

                                <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                                    <button className="glass-button" disabled={saving} onClick={save} style={{ padding: "0.8rem 1.4rem" }}>
                                        {saving ? "Saving…" : "Save progress"}
                                    </button>
                                    <button className="glass-button" disabled={saving} onClick={submit} style={{ background: "rgba(34,197,94,0.2)", borderColor: "rgba(34,197,94,0.4)", padding: "0.8rem 1.4rem" }}>
                                        {saving ? "Working…" : "Submit & continue"}
                                    </button>
                                </div>
                            </div>
                        ) : inStatus === "PENDING_EXTERNAL_ACTION" ? (
                            <div className="glass-container" style={{ padding: "1.75rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                                <div>
                                    <h2 style={{ marginTop: 0, marginBottom: "0.25rem" }}>Two quick steps</h2>
                                    <p style={{ color: "var(--color-text-muted)", margin: 0 }}>
                                        These can be done in any order. We&apos;ll move you forward automatically once both are complete.
                                    </p>
                                </div>

                                <ExternalTask
                                    done={!!state.external?.contractSigned}
                                    title="Sign your membership contract"
                                    doneText="Contract signed — thank you!"
                                >
                                    <p style={{ margin: 0, color: "var(--color-text-muted)" }}>
                                        We&apos;ve sent your membership contract via Zoho Sign. Please check your email and sign it. This page updates
                                        automatically once it&apos;s signed.
                                    </p>
                                </ExternalTask>

                                <ExternalTask
                                    done={!!state.external?.bgConsented}
                                    title="Consent to a background check"
                                    doneText="Background-check consent received."
                                >
                                    {state.external?.deepLinkUrl ? (
                                        <a href={state.external.deepLinkUrl} target="_blank" rel="noopener noreferrer" className="glass-button" style={{ display: "inline-block", textDecoration: "none", color: "white", padding: "0.6rem 1.1rem", background: "rgba(59,130,246,0.3)", borderColor: "rgba(59,130,246,0.5)" }}>
                                            Consent on Averity →
                                        </a>
                                    ) : (
                                        <p style={{ margin: 0, color: "var(--color-text-muted)" }}>The background-check link isn&apos;t available yet. Please check back shortly.</p>
                                    )}
                                </ExternalTask>

                                <button className="glass-button" disabled={saving} onClick={load} style={{ alignSelf: "flex-start", padding: "0.6rem 1.1rem" }}>
                                    Refresh status
                                </button>
                            </div>
                        ) : inStatus === "PENDING_PAYMENT" ? (
                            <div className="glass-container" style={{ padding: "1.75rem" }}>
                                <h2 style={{ marginTop: 0 }}>Membership dues</h2>
                                {payment ? (
                                    <>
                                        <p style={{ color: "var(--color-text-muted)" }}>
                                            Your annual household dues are{" "}
                                            <strong style={{ color: "var(--color-text-main, #f8fafc)" }}>
                                                ${(payment.amountCents / 100).toFixed(2)}
                                            </strong>.
                                        </p>
                                        {payment.invoiceUrl ? (
                                            <a href={payment.invoiceUrl} target="_blank" rel="noopener noreferrer" className="glass-button" style={{ display: "inline-block", textDecoration: "none", color: "white", padding: "0.85rem 1.4rem", background: "rgba(34,197,94,0.25)", borderColor: "rgba(34,197,94,0.5)" }}>
                                                Pay here with Shopify →
                                            </a>
                                        ) : (
                                            <p style={{ color: "#fcd34d" }}>The payment link isn&apos;t available yet. Please check back shortly.</p>
                                        )}
                                        <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)", marginTop: "1.25rem" }}>
                                            To discuss alternative arrangements, please email{" "}
                                            <a href="mailto:finance@innovationtreehouse.org" style={{ color: "var(--color-primary, #3b82f6)" }}>finance@innovationtreehouse.org</a>.
                                        </p>
                                    </>
                                ) : (
                                    <p style={{ color: "var(--color-text-muted)" }}>Preparing your invoice…</p>
                                )}
                            </div>
                        ) : (
                            <div className="glass-container" style={{ padding: "2rem" }}>
                                <h2 style={{ marginTop: 0 }}>Application in progress</h2>
                                <p style={{ color: "var(--color-text-muted)" }}>
                                    Your information is in. Follow the steps on the left — the next stages (background check and payment)
                                    will appear here as they open.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </main>
    );
}
