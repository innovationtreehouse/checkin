"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "../../page.module.css";

export default function ManualAttendance() {
    const router = useRouter();
    const [arrived, setArrived] = useState("");
    const [departed, setDeparted] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState("");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");
        setSuccess("");

        try {
            const res = await fetch("/api/attendance/manual", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ arrived, departed }),
            });

            const data = await res.json();
            if (!res.ok) {
                setError(data.error || "Failed to record manual visit.");
            } else {
                setSuccess("Visit recorded successfully.");
                setArrived("");
                setDeparted("");
            }
        } catch (err) {
            setError("Network error occurred.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <main className={styles.main}>
            <div className="glass-container" style={{ width: "100%", maxWidth: "600px", margin: "0 auto" }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                    <h1 className="text-gradient" style={{ margin: 0 }}>Manual Time Entry</h1>
                    <button
                        onClick={() => router.push("/kioskdisplay")}
                        style={{
                            background: "rgba(255, 255, 255, 0.1)",
                            border: "1px solid rgba(255, 255, 255, 0.2)",
                            color: "white",
                            padding: "0.5rem 1rem",
                            borderRadius: "1rem",
                            cursor: "pointer",
                        }}
                    >
                        &larr; Back to Attendance
                    </button>
                </div>

                <p style={{ color: "var(--color-text-muted)", marginBottom: "2rem" }}>
                    Forgot to scan your badge? You can self-correct your time record here. If you are currently in the building, leave the departure time blank.
                </p>

                {error && <div style={{ color: "#ef4444", marginBottom: "1rem", padding: "0.75rem", background: "rgba(239, 68, 68, 0.1)", borderRadius: "8px" }}>{error}</div>}
                {success && <div style={{ color: "#10b981", marginBottom: "1rem", padding: "0.75rem", background: "rgba(16, 185, 129, 0.1)", borderRadius: "8px" }}>{success}</div>}

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                    <div>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>Arrival Time (Required)</label>
                        <input
                            type="datetime-local"
                            value={arrived}
                            onChange={(e) => setArrived(e.target.value)}
                            required
                            style={{
                                width: "100%",
                                padding: "0.75rem",
                                borderRadius: "8px",
                                border: "1px solid rgba(255, 255, 255, 0.2)",
                                background: "rgba(0, 0, 0, 0.2)",
                                color: "white",
                            }}
                        />
                    </div>
                    <div>
                        <label style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>Departure Time (Optional)</label>
                        <input
                            type="datetime-local"
                            value={departed}
                            onChange={(e) => setDeparted(e.target.value)}
                            style={{
                                width: "100%",
                                padding: "0.75rem",
                                borderRadius: "8px",
                                border: "1px solid rgba(255, 255, 255, 0.2)",
                                background: "rgba(0, 0, 0, 0.2)",
                                color: "white",
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={loading || !arrived}
                        style={{
                            marginTop: "1rem",
                            padding: "1rem",
                            borderRadius: "8px",
                            border: "none",
                            background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
                            color: "white",
                            fontWeight: "bold",
                            cursor: loading || !arrived ? "not-allowed" : "pointer",
                            opacity: loading || !arrived ? 0.7 : 1,
                        }}
                    >
                        {loading ? "Saving..." : "Record Time Entry"}
                    </button>
                </form>
            </div>
        </main>
    );
}
