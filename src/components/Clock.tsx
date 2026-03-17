"use client";

import { useState, useEffect } from "react";

export default function Clock() {
    const [currentTime, setCurrentTime] = useState<Date | null>(null);

    useEffect(() => {
        setCurrentTime(new Date());
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    if (!currentTime) {
        return <div style={{ minHeight: "3.5rem" }} />; // Placeholder to avoid layout shift
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", fontVariantNumeric: "tabular-nums" }}>
            <div style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)", fontWeight: "bold", lineHeight: 1, color: "var(--color-text-main)", opacity: 0.9 }}>
                {currentTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </div>
            <div style={{ fontSize: "clamp(1rem, 2.5vw, 1.5rem)", fontWeight: 500, color: "var(--color-text-muted)", marginTop: "0.25rem" }}>
                {currentTime.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </div>
        </div>
    );
}
