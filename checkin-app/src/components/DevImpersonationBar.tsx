"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { useIsDevInstance } from "@/components/EnvProvider";

/**
 * Persistent dev-instance bar (DEV_INSTANCE_DESIGN.md §5/§7, minimal slice).
 *
 * Rendered only on the dev/local instance for a signed-in user. Shows who you really are while
 * impersonating (derived from the inert `impersonatedBy` claim) and lets you return to yourself.
 * Switching personas lives in the bottom "Change mock account" drawer (DevDashboard); both go
 * through the single persona-mint flow.
 */
export default function DevImpersonationBar() {
    const { data: session } = useSession();
    const isDevInstance = useIsDevInstance();
    const [busy, setBusy] = useState(false);

    const signedIn = !!session?.user;

    if (!isDevInstance || !signedIn) return null;

    const impersonatedBy = session.user.impersonatedBy;
    const currentName = session.user.name || session.user.email;

    const returnToMe = () => {
        setBusy(true);
        // Land back on the page being viewed, re-rendered as the real identity.
        signIn("persona-mint", {
            mode: "return",
            callbackUrl: window.location.pathname + window.location.search,
        });
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

            {impersonatedBy && (
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button
                        type="button"
                        onClick={returnToMe}
                        disabled={busy}
                        className="glass-button"
                        style={{ padding: "0.25rem 0.75rem", cursor: busy ? "wait" : "pointer" }}
                    >
                        {busy ? "Returning…" : "Return to me"}
                    </button>
                </span>
            )}
        </div>
    );
}
