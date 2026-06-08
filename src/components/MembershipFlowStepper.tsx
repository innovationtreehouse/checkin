import { INITIAL_PHASES, phaseIndex } from "@/lib/membership/phases";
import type { MembershipProcessStatus } from "@prisma/client";

/**
 * Left-rail flow diagram for the membership application. Shows the INITIAL
 * phases with the caller's current position; BLOCKED renders an inline alert
 * (the board has been notified) rather than a normal step.
 */
export default function MembershipFlowStepper({
    currentStatus,
}: {
    currentStatus: MembershipProcessStatus | null;
}) {
    const blocked = currentStatus === "BLOCKED";
    // Before starting (null), nothing is complete; treat position as -1.
    const activeIdx = currentStatus ? phaseIndex(currentStatus) : -1;

    return (
        <div className="glass-container" style={{ padding: "1.5rem", minWidth: "240px" }}>
            <h3 style={{ marginTop: 0, marginBottom: "1.25rem", fontSize: "1rem", color: "var(--color-text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Your application
            </h3>

            {blocked && (
                <div style={{ marginBottom: "1.25rem", padding: "0.75rem", background: "rgba(239, 68, 68, 0.15)", border: "1px solid rgba(239, 68, 68, 0.4)", borderRadius: "8px", color: "#fca5a5", fontSize: "0.85rem" }}>
                    Your application needs attention. Our team has been notified and will reach out.
                </div>
            )}

            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                {INITIAL_PHASES.map((phase, idx) => {
                    const done = activeIdx > idx;
                    const current = activeIdx === idx;
                    const dotColor = done ? "#4ade80" : current ? "var(--color-primary, #3b82f6)" : "rgba(255,255,255,0.18)";
                    return (
                        <li key={phase.status} style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                                <span
                                    aria-hidden
                                    style={{
                                        width: "22px",
                                        height: "22px",
                                        borderRadius: "50%",
                                        background: dotColor,
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: "0.75rem",
                                        color: done || current ? "#0f172a" : "var(--color-text-muted)",
                                        fontWeight: 700,
                                        flexShrink: 0,
                                    }}
                                >
                                    {done ? "✓" : idx + 1}
                                </span>
                                {idx < INITIAL_PHASES.length - 1 && (
                                    <span style={{ width: "2px", flex: 1, minHeight: "22px", background: done ? "#4ade80" : "rgba(255,255,255,0.12)" }} />
                                )}
                            </div>
                            <div style={{ paddingBottom: "1rem" }}>
                                <div style={{ fontWeight: current ? 700 : 500, color: current ? "var(--color-text-main, #f8fafc)" : done ? "#86efac" : "var(--color-text-muted)" }}>
                                    {phase.label}
                                </div>
                                <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", marginTop: "2px" }}>
                                    {phase.description}
                                </div>
                            </div>
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}
