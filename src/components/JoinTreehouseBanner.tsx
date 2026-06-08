import Link from "next/link";

/**
 * Visitor call-to-action — shown to logged-in non-members to start a membership
 * application. Render only when the viewer is not an active member.
 */
export default function JoinTreehouseBanner() {
    return (
        <div
            style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "1rem",
                padding: "1.25rem 1.5rem",
                background: "rgba(59, 130, 246, 0.15)",
                border: "1px solid rgba(59, 130, 246, 0.45)",
                borderRadius: "var(--glass-radius, 16px)",
            }}
        >
            <div>
                <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>Join the Treehouse — become a member today!</div>
                <div style={{ color: "var(--color-text-muted)", fontSize: "0.9rem", marginTop: "2px" }}>
                    Tell us about your family to start your membership application.
                </div>
            </div>
            <Link
                href="/membership"
                className="glass-button"
                style={{ background: "rgba(59, 130, 246, 0.3)", borderColor: "rgba(59, 130, 246, 0.5)", whiteSpace: "nowrap", textDecoration: "none", color: "white", padding: "0.75rem 1.25rem" }}
            >
                Get started →
            </Link>
        </div>
    );
}
