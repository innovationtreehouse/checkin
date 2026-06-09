"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface Settings {
    normalDuesCents: number;
    volunteerDuesCents: number;
    membershipYearBoundary: string | null;
}
interface Designation {
    id: number;
    email: string;
    createdAt: string;
}

const dollars = (cents: number) => (cents / 100).toFixed(2);

export default function MembershipSettingsPage() {
    const [normalDues, setNormalDues] = useState("0");
    const [volunteerDues, setVolunteerDues] = useState("0");
    const [boundary, setBoundary] = useState("");
    const [boundaryUnlocked, setBoundaryUnlocked] = useState(false);

    const [designations, setDesignations] = useState<Designation[]>([]);
    const [newEmail, setNewEmail] = useState("");

    const [bulkReminders, setBulkReminders] = useState(false);

    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);

    const flash = (m: string, err = false) => { setMessage(m); setIsError(err); };

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [sRes, dRes] = await Promise.all([
                fetch("/api/admin/membership/settings"),
                fetch("/api/admin/membership/volunteer-designations"),
            ]);
            if (sRes.ok) {
                const { settings } = (await sRes.json()) as { settings: Settings };
                setNormalDues(dollars(settings.normalDuesCents));
                setVolunteerDues(dollars(settings.volunteerDuesCents));
                setBoundary(settings.membershipYearBoundary ? settings.membershipYearBoundary.slice(0, 10) : "");
            }
            if (dRes.ok) setDesignations((await dRes.json()).designations || []);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const saveSettings = async () => {
        setSaving(true);
        flash("");
        try {
            const res = await fetch("/api/admin/membership/settings", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    normalDuesCents: Math.round(parseFloat(normalDues || "0") * 100),
                    volunteerDuesCents: Math.round(parseFloat(volunteerDues || "0") * 100),
                    ...(boundaryUnlocked ? { membershipYearBoundary: boundary || null } : {}),
                }),
            });
            if (res.ok) { flash("Settings saved."); setBoundaryUnlocked(false); await load(); }
            else flash((await res.json()).error || "Save failed.", true);
        } catch { flash("Network error.", true); }
        finally { setSaving(false); }
    };

    const addDesignation = async () => {
        if (!newEmail.trim()) return;
        setSaving(true);
        flash("");
        try {
            const res = await fetch("/api/admin/membership/volunteer-designations", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email: newEmail }),
            });
            const data = await res.json();
            if (res.ok) {
                setNewEmail("");
                flash(data.warning || "Designation added.", !!data.warning);
                await load();
            } else flash(data.error || "Could not add.", true);
        } catch { flash("Network error.", true); }
        finally { setSaving(false); }
    };

    const removeDesignation = async (id: number) => {
        setSaving(true);
        try {
            await fetch(`/api/admin/membership/volunteer-designations?id=${id}`, { method: "DELETE" });
            await load();
        } finally { setSaving(false); }
    };

    const bulkOpenRenewals = async () => {
        if (!confirm("Open a renewal cycle for ALL active members now? This is a one-time go-live action.")) return;
        setSaving(true);
        flash("");
        try {
            const res = await fetch("/api/admin/membership/bulk-open-renewals", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ sendReminders: bulkReminders }),
            });
            const data = await res.json();
            if (res.ok) flash(`Opened ${data.opened} renewal(s); ${data.skipped} already in progress.`);
            else flash(data.error || "Failed.", true);
        } catch { flash("Network error.", true); }
        finally { setSaving(false); }
    };

    const labelStyle: React.CSSProperties = { display: "block", marginBottom: "0.35rem", fontWeight: 500 };
    const fieldStyle: React.CSSProperties = { width: "100%", maxWidth: "320px", padding: "0.6rem" };

    return (
        <div style={{ maxWidth: "820px", margin: "0 auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem", marginBottom: "1.5rem" }}>
                <h1 className="text-gradient" style={{ margin: 0 }}>Membership Settings</h1>
                <Link href="/admin/membership" className="glass-button" style={{ textDecoration: "none", color: "white" }}>&larr; Applications</Link>
            </div>

            {message && (
                <div style={{ marginBottom: "1.25rem", padding: "0.85rem 1rem", borderRadius: "8px", background: isError ? "rgba(245,158,11,0.12)" : "rgba(34,197,94,0.1)", border: `1px solid ${isError ? "rgba(245,158,11,0.4)" : "rgba(34,197,94,0.3)"}`, color: isError ? "#fcd34d" : "#4ade80" }}>
                    {message}
                </div>
            )}

            {loading ? (
                <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>
            ) : (
                <>
                    <div className="glass-container" style={{ padding: "1.75rem", marginBottom: "1.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                        <h2 style={{ marginTop: 0 }}>Dues &amp; configuration</h2>
                        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
                            <div>
                                <label style={labelStyle}>Annual dues (normal)</label>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                    <span>$</span>
                                    <input className="glass-input" style={{ ...fieldStyle, maxWidth: "160px" }} value={normalDues} onChange={(e) => setNormalDues(e.target.value)} inputMode="decimal" />
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>Annual dues (volunteer)</label>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                    <span>$</span>
                                    <input className="glass-input" style={{ ...fieldStyle, maxWidth: "160px" }} value={volunteerDues} onChange={(e) => setVolunteerDues(e.target.value)} inputMode="decimal" />
                                </div>
                            </div>
                        </div>

                        <div style={{ fontSize: "0.85rem", color: "#fcd34d", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.35)", borderRadius: "10px", padding: "0.75rem 1rem" }}>
                            ⚠️ These amounts only set what applicants <strong>see</strong> in the membership process. They do <strong>not</strong> change what members are actually charged — the matching Shopify variant prices must be updated separately.
                        </div>

                        <div style={{ border: "1px solid rgba(245,158,11,0.35)", borderRadius: "10px", padding: "1rem", background: "rgba(245,158,11,0.06)" }}>
                            <label style={labelStyle}>Membership-year boundary</label>
                            <div style={{ fontSize: "0.85rem", color: "#fcd34d", marginBottom: "0.6rem" }}>
                                ⚠️ Changing this date shifts the renewal cycle for <strong>every household</strong>. Only change it if you are sure.
                            </div>
                            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem", cursor: "pointer" }}>
                                <input type="checkbox" checked={boundaryUnlocked} onChange={(e) => setBoundaryUnlocked(e.target.checked)} />
                                <span>I understand — let me edit the boundary date</span>
                            </label>
                            <input type="date" className="glass-input" style={{ ...fieldStyle, maxWidth: "220px", opacity: boundaryUnlocked ? 1 : 0.5 }} value={boundary} onChange={(e) => setBoundary(e.target.value)} disabled={!boundaryUnlocked} />
                        </div>

                        <button className="glass-button" disabled={saving} onClick={saveSettings} style={{ alignSelf: "flex-start", padding: "0.7rem 1.3rem", background: "rgba(59,130,246,0.25)", borderColor: "rgba(59,130,246,0.5)" }}>
                            {saving ? "Saving…" : "Save settings"}
                        </button>
                    </div>

                    <div className="glass-container" style={{ padding: "1.75rem" }}>
                        <h2 style={{ marginTop: 0 }}>Volunteer-designated emails</h2>
                        <p style={{ color: "var(--color-text-muted)", marginTop: 0 }}>
                            If one of these emails applies for membership, that whole household is treated as a volunteer family (lower dues).
                        </p>
                        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem" }}>
                            <input className="glass-input" style={{ ...fieldStyle, maxWidth: "320px" }} value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="volunteer@example.com" />
                            <button className="glass-button" disabled={saving} onClick={addDesignation} style={{ padding: "0.6rem 1.1rem" }}>Add</button>
                        </div>
                        {designations.length === 0 ? (
                            <p style={{ color: "var(--color-text-muted)" }}>No volunteer designations yet.</p>
                        ) : (
                            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                                {designations.map((d) => (
                                    <li key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 0", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                                        <span>{d.email}</span>
                                        <button onClick={() => removeDesignation(d.id)} disabled={saving} style={{ background: "none", border: "none", color: "#f87171", cursor: "pointer" }}>Remove</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="glass-container" style={{ padding: "1.75rem", marginTop: "1.5rem", border: "1px solid rgba(245,158,11,0.35)" }}>
                        <h2 style={{ marginTop: 0 }}>Go-live: open renewals</h2>
                        <p style={{ color: "#fcd34d", fontSize: "0.9rem" }}>
                            ⚠️ One-time go-live action. Opens a renewal cycle for <strong>every active member</strong> so they renew for the upcoming year.
                            Press this once, after your existing members are imported (board or sysadmin).
                        </p>
                        <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.75rem 0", cursor: "pointer" }}>
                            <input type="checkbox" checked={bulkReminders} onChange={(e) => setBulkReminders(e.target.checked)} />
                            <span>Also email each household a renewal reminder</span>
                        </label>
                        <button className="glass-button" disabled={saving} onClick={bulkOpenRenewals} style={{ padding: "0.7rem 1.3rem", background: "rgba(245,158,11,0.2)", borderColor: "rgba(245,158,11,0.45)" }}>
                            {saving ? "Working…" : "Open renewals for all active members"}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
