import type { VisitSource } from "@/generated/prisma/client";

/**
 * Post-hoc significance of a self-correction (design doc
 * 1256_ATTENDANCE_CORRECTION_SURFACE.md §2): the edit always applies; a change
 * is flagged to the board only when it is large relative to how authoritative
 * the value it overwrote was. significance = Σ per-field (minutes shifted ×
 * source trust-weight), over a threshold. Every delete flags (the floor):
 * erasing a record is inherently notable.
 *
 * Weights and threshold are the v1 defaults awaiting board calibration
 * (design §6.2); promote to BoardSettings when the AT12 screen gives the board
 * a place to calibrate from.
 */

// SYSTEM is overloaded today (design "Terminology"): on arrivedVia it is a
// staff roster-mark (high trust — someone else's observation); as a
// departure paired with a real arrival it is an automated auto-close guess
// the member is *meant* to fix (lowest trust). The AT3 rename to
// LEAD_MARKED/AUTO_CLOSE retires this inference.
const WEIGHTS: Record<VisitSource, number> = {
    SCANNER: 3, // physical measurement
    SYSTEM: 2,  // staff observation (roster mark)
    WEB: 1,     // the member's own prior self-report
};
const AUTO_CLOSE_WEIGHT = 0.25; // machine-guessed placeholder
// Sits above a 15-min shift of both ends of a roster-marked visit (60) and
// below a 2h move of a scanned arrival (360) — the design's no/yes examples.
const FLAG_THRESHOLD = 90; // weighted minutes

type VisitTimes = {
    arrivedAt: Date;
    departedAt: Date | null;
    arrivedVia: VisitSource | null;
    departedVia: VisitSource | null;
};

export type Significance = { score: number; flagged: boolean };

function weightOf(source: VisitSource | null, field: "arrival" | "departure", visit: VisitTimes): number {
    if (!source) return WEIGHTS.WEB; // untagged legacy value ≈ self-reported
    if (source === "SYSTEM" && field === "departure" && visit.arrivedVia !== "SYSTEM") {
        return AUTO_CLOSE_WEIGHT;
    }
    return WEIGHTS[source];
}

function minutesBetween(a: Date | null, b: Date | null): number {
    // One side null only when CLOSING an open visit (reopening is rejected at
    // the route) — the most routine correction there is; no delta to weigh.
    if (!a || !b) return 0;
    return Math.abs(a.getTime() - b.getTime()) / 60000;
}

/** Significance of editing a visit's times, weighted by the OLD values' sources. */
export function editSignificance(
    oldVisit: VisitTimes,
    newTimes: { arrivedAt: Date; departedAt: Date | null },
): Significance {
    const score =
        minutesBetween(oldVisit.arrivedAt, newTimes.arrivedAt) * weightOf(oldVisit.arrivedVia, "arrival", oldVisit) +
        minutesBetween(oldVisit.departedAt, newTimes.departedAt) * weightOf(oldVisit.departedVia, "departure", oldVisit);
    return { score: Math.round(score), flagged: score >= FLAG_THRESHOLD };
}

/** A delete always flags — the floor. Score reflects how much recorded time vanished. */
export function deleteSignificance(visit: VisitTimes): Significance {
    const duration = visit.departedAt
        ? minutesBetween(visit.arrivedAt, visit.departedAt)
        : 0;
    const weight = Math.max(
        weightOf(visit.arrivedVia, "arrival", visit),
        weightOf(visit.departedVia, "departure", visit),
    );
    return { score: Math.round(duration * weight), flagged: true };
}
