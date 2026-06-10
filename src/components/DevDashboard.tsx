"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useIsDevInstance } from "@/components/EnvProvider";
import {
    macroFamily,
    macroProgram,
    macroEvent,
    macroCheckins,
    resetDevInstance,
    getRecentActivity,
    type ActionResult,
} from "@/lib/dev/actions";

/**
 * The dev dashboard (DEV_DASHBOARD_DESIGN.md §7) — a slide-up panel, rendered only on the
 * dev/local instance for a signed-in org member. Collapsed to a 🛠 FAB so it never obscures the
 * app; expands to the macros + reset + ledger line. The persona switcher / "return to me" lives in
 * the separate persistent DevImpersonationBar. All actions go through the fenced server actions.
 */

interface Entry {
    action: string;
    realActor: string;
    detail: string | null;
    createdAt: string | Date;
}

function relTime(when: string | Date): string {
    const ms = Date.now() - new Date(when).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} min ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hr ago`;
    return `${Math.floor(hr / 24)} d ago`;
}

function describe(e: Entry): string {
    const who = e.realActor;
    if (e.action === "reset") return `${who} reset`;
    if (e.action === "login") return `${who} signed in`;
    if (e.action === "impersonate") return `${who} impersonated ${e.detail ?? "a persona"}`;
    if (e.action.startsWith("macro:")) return `${who} ran ${e.action.slice(6)} macro`;
    return `${who} — ${e.action}`;
}

const MACROS: { label: string; action: () => Promise<ActionResult> }[] = [
    { label: "+ Family", action: macroFamily },
    { label: "+ Program", action: macroProgram },
    { label: "+ Event", action: macroEvent },
    { label: "+ Check-ins", action: macroCheckins },
];

export default function DevDashboard() {
    const { data: session } = useSession();
    const isDevInstance = useIsDevInstance();
    const router = useRouter();

    const [open, setOpen] = useState(false);
    const [confirmingReset, setConfirmingReset] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [activity, setActivity] = useState<Entry[]>([]);
    const [pending, startTransition] = useTransition();

    const signedIn = !!session?.user;

    const loadActivity = useCallback(() => {
        getRecentActivity(5)
            .then(setActivity)
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (isDevInstance && signedIn && open) loadActivity();
    }, [isDevInstance, signedIn, open, loadActivity]);

    if (!isDevInstance || !signedIn) return null;

    const flash = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast((t) => (t === msg ? null : t)), 4000);
    };

    const runMacro = (fn: () => Promise<ActionResult>) => {
        startTransition(async () => {
            try {
                const res = await fn();
                flash(`✅ ${res.summary}`);
                router.refresh();
                loadActivity();
            } catch {
                flash("⚠️ Action failed — are you a verified org member?");
            }
        });
    };

    const doReset = () => {
        setConfirmingReset(false);
        startTransition(async () => {
            try {
                await resetDevInstance();
                // The reset reseeds participants with fresh ids, so the current minted session is
                // now stale — sign out and let the user re-pick a persona against the clean DB.
                flash("✅ Reset complete — signing out to re-pick a persona…");
                setTimeout(() => signOut({ callbackUrl: "/" }), 1200);
            } catch {
                flash("⚠️ Reset failed");
            }
        });
    };

    const lastActivity = activity[0];

    return (
        <div style={{ position: "fixed", right: "1rem", bottom: "1rem", zIndex: 1000 }}>
            {/* Toast */}
            {toast && (
                <div
                    style={{
                        marginBottom: "0.5rem",
                        maxWidth: 320,
                        padding: "0.5rem 0.75rem",
                        borderRadius: 8,
                        background: "rgba(17, 24, 39, 0.95)",
                        color: "white",
                        fontSize: "0.8rem",
                        boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
                    }}
                >
                    {toast}
                </div>
            )}

            {/* Panel */}
            {open && (
                <div
                    style={{
                        width: 320,
                        marginBottom: "0.5rem",
                        padding: "1rem",
                        borderRadius: 12,
                        background: "rgba(17, 24, 39, 0.97)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "white",
                        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", marginBottom: "0.75rem" }}>
                        <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>🛠 Dev Dashboard</span>
                        <button
                            onClick={() => setOpen(false)}
                            aria-label="Close dev dashboard"
                            style={{ marginLeft: "auto", background: "none", border: "none", color: "rgba(255,255,255,0.6)", cursor: "pointer", fontSize: "1rem" }}
                        >
                            ✕
                        </button>
                    </div>

                    {/* Macros */}
                    <div style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.05em", color: "#9ca3af", marginBottom: "0.4rem" }}>
                        Macros
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.9rem" }}>
                        {MACROS.map((m) => (
                            <button
                                key={m.label}
                                onClick={() => runMacro(m.action)}
                                disabled={pending}
                                style={macroBtn(pending)}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>

                    {/* Ledger line */}
                    <div style={{ fontSize: "0.72rem", color: "#9ca3af", marginBottom: "0.75rem", minHeight: "1rem" }}>
                        {lastActivity
                            ? `Last activity: ${describe(lastActivity)} ${relTime(lastActivity.createdAt)}`
                            : "No recorded activity yet"}
                    </div>

                    {/* Reset */}
                    {confirmingReset ? (
                        <div style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: 8, padding: "0.6rem" }}>
                            <div style={{ fontSize: "0.78rem", marginBottom: "0.5rem" }}>
                                {lastActivity
                                    ? `${describe(lastActivity)} ${relTime(lastActivity.createdAt)}. Reset anyway?`
                                    : "Truncate all data and reseed the baseline?"}
                            </div>
                            <div style={{ display: "flex", gap: "0.4rem" }}>
                                <button onClick={doReset} disabled={pending} style={{ ...dangerBtn, flex: 1 }}>
                                    {pending ? "Resetting…" : "Yes, reset"}
                                </button>
                                <button onClick={() => setConfirmingReset(false)} disabled={pending} style={{ ...macroBtn(false), flex: 1 }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : (
                        <button onClick={() => setConfirmingReset(true)} disabled={pending} style={{ ...dangerBtn, width: "100%" }}>
                            🔴 Reset dev instance
                        </button>
                    )}
                </div>
            )}

            {/* FAB */}
            <button
                onClick={() => setOpen((o) => !o)}
                aria-label="Toggle dev dashboard"
                style={{
                    marginLeft: "auto",
                    display: "block",
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: pending ? "#f59e0b" : "#1f2937",
                    border: "1px solid rgba(255,255,255,0.2)",
                    color: "white",
                    fontSize: "1.3rem",
                    cursor: "pointer",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
                }}
            >
                {pending ? "⏳" : "🛠"}
            </button>
        </div>
    );
}

function macroBtn(pending: boolean): React.CSSProperties {
    return {
        padding: "0.5rem",
        borderRadius: 8,
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.12)",
        color: "white",
        fontSize: "0.8rem",
        cursor: pending ? "wait" : "pointer",
        opacity: pending ? 0.6 : 1,
    };
}

const dangerBtn: React.CSSProperties = {
    padding: "0.5rem",
    borderRadius: 8,
    background: "rgba(239,68,68,0.85)",
    border: "1px solid rgba(239,68,68,1)",
    color: "white",
    fontSize: "0.8rem",
    fontWeight: 600,
    cursor: "pointer",
};
