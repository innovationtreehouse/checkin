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

const WEIGHTS: Record<VisitSource, number> = {
    SCANNER: 3,     // physical measurement
    LEAD_MARKED: 2, // staff observation (roster mark)
    WEB: 1,         // the member's own prior self-report
    // A machine close is a placeholder the member is *meant* to fix, so
    // correcting one never flags — suppressed by SOURCE, not magnitude (design
    // §2): the cron stamps at its own run time, making the correction largest
    // exactly where the overwritten value deserves the least trust.
    FACILITY_CLOSE: 0,
    AUTO_CLOSE: 0,
    // Legacy, pre-split. It fused the roster mark with both machine closes, so
    // no single weight is right; take the roster-mark reading, since that is the
    // only meaning it ever carried on arrivedVia. Rows written by the previous
    // release during a rolling deploy's drain window are the last of these.
    SYSTEM: 2,
};
// Sits above a 15-min shift of both ends of a roster-marked visit (60) and
// below a 2h move of a scanned arrival (360) — the design's no/yes examples.
const FLAG_THRESHOLD = 90; // weighted minutes
// One adult changing another person's record is itself a flag input (design
// §3), so a household lead's edit of a member's visit weighs double: the same
// nudge that is noise on your own record is worth seeing on someone else's.
const PROXY_MULTIPLIER = 2;

type VisitTimes = {
    arrivedAt: Date;
    departedAt: Date | null;
    arrivedVia: VisitSource | null;
    departedVia: VisitSource | null;
};

export type Significance = { score: number; flagged: boolean };

function weightOf(source: VisitSource | null, field: "arrival" | "departure", visit: VisitTimes): number {
    if (!source) return WEIGHTS.WEB; // untagged legacy value ≈ self-reported
    // Legacy SYSTEM only: pre-split it fused the roster mark with the machine
    // closes, so the closer has to be inferred — a SYSTEM departure on a real
    // (non-SYSTEM) arrival was a machine close. FACILITY_CLOSE / AUTO_CLOSE say
    // so outright, which is what the split bought; this branch dies with the
    // value in the contract release.
    if (source === "SYSTEM" && field === "departure" && visit.arrivedVia !== "SYSTEM") {
        return 0;
    }
    return WEIGHTS[source];
}

function minutesBetween(a: Date | null, b: Date | null): number {
    // One side null only when CLOSING an open visit (reopening is rejected at
    // the route) — the most routine correction there is; no delta to weigh.
    if (!a || !b) return 0;
    return Math.abs(a.getTime() - b.getTime()) / 60000;
}

/** `byProxy`: the actor is not the visit's person (a household lead acting for a member). */
export type SignificanceOpts = { byProxy?: boolean };

/** Significance of editing a visit's times, weighted by the OLD values' sources. */
export function editSignificance(
    oldVisit: VisitTimes,
    newTimes: { arrivedAt: Date; departedAt: Date | null },
    opts: SignificanceOpts = {},
): Significance {
    const score = (
        minutesBetween(oldVisit.arrivedAt, newTimes.arrivedAt) * weightOf(oldVisit.arrivedVia, "arrival", oldVisit) +
        minutesBetween(oldVisit.departedAt, newTimes.departedAt) * weightOf(oldVisit.departedVia, "departure", oldVisit)
    ) * (opts.byProxy ? PROXY_MULTIPLIER : 1);
    return { score: Math.round(score), flagged: score >= FLAG_THRESHOLD };
}

/** A delete always flags — the floor. Score reflects how much recorded time vanished. */
export function deleteSignificance(visit: VisitTimes, opts: SignificanceOpts = {}): Significance {
    const duration = visit.departedAt
        ? minutesBetween(visit.arrivedAt, visit.departedAt)
        : 0;
    const weight = Math.max(
        weightOf(visit.arrivedVia, "arrival", visit),
        weightOf(visit.departedVia, "departure", visit),
    );
    return { score: Math.round(duration * weight * (opts.byProxy ? PROXY_MULTIPLIER : 1)), flagged: true };
}
