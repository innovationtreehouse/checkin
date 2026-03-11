"use client";
/* eslint-disable react-hooks/purity */

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";

interface Persona {
    id: number;
    email: string;
    name: string | null;
    sysadmin: boolean;
    boardMember: boolean;
    keyholder: boolean;
    shopSteward: boolean;
    dob: string | null;
    householdId: number | null;
    toolStatuses: { toolId: number; level: string }[];
}

/**
 * DevLoginPicker — renders a list of debug personas for quick login.
 * Only rendered in dev mode when the user is NOT signed in.
 */
export default function DevLoginPicker() {
    const [personas, setPersonas] = useState<Persona[]>([]);
    const [loading, setLoading] = useState(true);
    const [signingIn, setSigningIn] = useState<string | null>(null);

    useEffect(() => {
        fetch("/api/auth/dev-personas")
            .then((res) => res.json())
            .then((data) => {
                setPersonas(data.personas || []);
                setLoading(false);
            })
            .catch(() => setLoading(false));
    }, []);

    const handleLogin = (email: string) => {
        setSigningIn(email);
        signIn("credentials", { email, callbackUrl: "/" });
    };

    const getRoleBadges = (p: Persona) => {
        const badges: { label: string; color: string }[] = [];
        if (p.sysadmin) badges.push({ label: "Sysadmin", color: "#ef4444" });
        if (p.boardMember) badges.push({ label: "Board", color: "#8b5cf6" });
        if (p.keyholder) badges.push({ label: "Keyholder", color: "#3b82f6" });
        if (p.shopSteward) badges.push({ label: "Shop Steward", color: "#f59e0b" });
        if (p.toolStatuses?.length > 0) badges.push({ label: "Certified", color: "#10b981" });
        if (p.householdId) badges.push({ label: "Household", color: "#6366f1" });
        if (p.dob) {
            const age = Math.floor(
                (Date.now() - new Date(p.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
            );
            if (age < 18) badges.push({ label: `Student (${age})`, color: "#ec4899" });
        }
        return badges;
    };

    if (loading) {
        return (
            <div style={{ marginTop: "1.5rem", textAlign: "center", color: "var(--color-text-muted)" }}>
                Loading dev personas...
            </div>
        );
    }

    if (personas.length === 0) return null;

    return (
        <div style={{ marginTop: "2rem", width: "100%" }}>
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                marginBottom: "1rem",
            }}>
                <div style={{
                    flex: 1,
                    height: "1px",
                    background: "rgba(255, 255, 255, 0.15)",
                }} />
                <span style={{
                    color: "#fbbf24",
                    fontSize: "0.8rem",
                    fontWeight: "bold",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                }}>
                    🛠 Dev Quick Login
                </span>
                <div style={{
                    flex: 1,
                    height: "1px",
                    background: "rgba(255, 255, 255, 0.15)",
                }} />
            </div>

            <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
                gap: "0.5rem",
            }}>
                {personas.map((p) => (
                    <button
                        key={p.id}
                        id={`dev-login-${p.email.split("@")[0].replace(/\./g, "-")}`}
                        onClick={() => handleLogin(p.email!)}
                        disabled={signingIn !== null}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            padding: "0.75rem 1rem",
                            background: signingIn === p.email
                                ? "rgba(251, 191, 36, 0.2)"
                                : "rgba(255, 255, 255, 0.05)",
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            borderRadius: "10px",
                            cursor: signingIn ? "wait" : "pointer",
                            textAlign: "left",
                            color: "white",
                            transition: "all 0.15s ease",
                            opacity: signingIn && signingIn !== p.email ? 0.5 : 1,
                        }}
                        onMouseEnter={(e) => {
                            if (!signingIn) {
                                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255, 255, 255, 0.1)";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(251, 191, 36, 0.4)";
                            }
                        }}
                        onMouseLeave={(e) => {
                            if (!signingIn) {
                                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255, 255, 255, 0.05)";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(255, 255, 255, 0.12)";
                            }
                        }}
                    >
                        <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>
                            {signingIn === p.email ? "⏳ " : ""}{p.name || p.email}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "var(--color-text-muted)" }}>
                            {p.email}
                        </span>
                        {getRoleBadges(p).length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "2px" }}>
                                {getRoleBadges(p).map((b) => (
                                    <span
                                        key={b.label}
                                        style={{
                                            background: b.color,
                                            color: "white",
                                            padding: "1px 6px",
                                            borderRadius: "8px",
                                            fontSize: "0.65rem",
                                            fontWeight: 600,
                                        }}
                                    >
                                        {b.label}
                                    </span>
                                ))}
                            </div>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
