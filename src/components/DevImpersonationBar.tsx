"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { useIsDevInstance } from "@/components/EnvProvider";

interface PersonaOption {
    id: number;
    email: string;
    name: string | null;
}

/**
 * Persistent dev-instance bar (DEV_INSTANCE_DESIGN.md §5/§7, minimal slice).
 *
 * Rendered only on the dev/local instance for a signed-in user. Shows who you really are while
 * impersonating (derived from the inert `impersonatedBy` claim), lets you switch personas, and
 * lets you return to yourself. All actions go through the single persona-mint flow.
 */
export default function DevImpersonationBar() {
    const { data: session } = useSession();
    const isDevInstance = useIsDevInstance();
    const [personas, setPersonas] = useState<PersonaOption[]>([]);
    const [busy, setBusy] = useState(false);

    const signedIn = !!session?.user;

    useEffect(() => {
        if (!isDevInstance || !signedIn) return;
        fetch("/api/auth/dev-personas", { cache: "no-store" })
            .then((res) => (res.ok ? res.json() : { personas: [] }))
            .then((data) => setPersonas(data.personas || []))
            .catch(() => setPersonas([]));
    }, [isDevInstance, signedIn]);

    if (!isDevInstance || !signedIn) return null;

    const impersonatedBy = session.user.impersonatedBy;
    const currentName = session.user.name || session.user.email;

    const impersonate = (personaId: string) => {
        if (!personaId) return;
        setBusy(true);
        signIn("persona-mint", { personaId, mode: "impersonate", callbackUrl: "/" });
    };

    const returnToMe = () => {
        setBusy(true);
        signIn("persona-mint", { mode: "return", callbackUrl: "/" });
    };

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                flexWrap: "wrap",
                padding: "0.5rem 1rem",
                background: impersonatedBy ? "rgba(236, 72, 153, 0.15)" : "rgba(59, 130, 246, 0.12)",
                borderBottom: `1px solid ${impersonatedBy ? "rgba(236, 72, 153, 0.4)" : "rgba(59, 130, 246, 0.3)"}`,
                fontSize: "0.85rem",
            }}
        >
            <span style={{ fontWeight: 600 }}>
                {impersonatedBy ? (
                    <>🎭 Viewing as <strong>{currentName}</strong> — you are {impersonatedBy}</>
                ) : (
                    <>🛠 Dev instance — signed in as <strong>{currentName}</strong></>
                )}
            </span>

            <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <select
                    aria-label="Switch persona"
                    defaultValue=""
                    disabled={busy || personas.length === 0}
                    onChange={(e) => impersonate(e.target.value)}
                    style={{ padding: "0.25rem 0.5rem", borderRadius: "6px" }}
                >
                    <option value="" disabled>
                        {busy ? "Switching…" : "Switch persona…"}
                    </option>
                    {personas.map((p) => (
                        <option key={p.id} value={String(p.id)}>
                            {p.name || p.email}
                        </option>
                    ))}
                </select>

                {impersonatedBy && (
                    <button
                        type="button"
                        onClick={returnToMe}
                        disabled={busy}
                        className="glass-button"
                        style={{ padding: "0.25rem 0.75rem", cursor: busy ? "wait" : "pointer" }}
                    >
                        Return to me
                    </button>
                )}
            </span>
        </div>
    );
}
