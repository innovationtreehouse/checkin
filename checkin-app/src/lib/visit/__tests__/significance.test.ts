import { editSignificance, deleteSignificance } from "../significance";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 6, 1, h, m));

// The design doc's worked examples (1256_ATTENDANCE_CORRECTION_SURFACE.md §2).
describe("editSignificance", () => {
    it("+5 min on own WEB arrival — noise, not flagged", () => {
        const r = editSignificance(
            { arrivedAt: at(14), departedAt: at(16), arrivedVia: "WEB", departedVia: "WEB" },
            { arrivedAt: at(14, 5), departedAt: at(16) },
        );
        expect(r.flagged).toBe(false);
    });

    // The nightly sweep stamps departedAt at CRON-RUN time, so the routine
    // "forgot to check out" fix is a 10h+ correction. Suppression is by source,
    // so no magnitude can push it over the threshold.
    it("fixing a machine-closed departure never flags, however large the correction", () => {
        const arrivedAt = new Date(Date.UTC(2026, 6, 1, 9));   // arrive 9am
        const r = editSignificance(
            { arrivedAt, departedAt: new Date(Date.UTC(2026, 6, 2, 2)), arrivedVia: "SCANNER", departedVia: "SYSTEM" },
            { arrivedAt, departedAt: new Date(Date.UTC(2026, 6, 1, 13)) }, // really left 1pm
        );
        expect(r.score).toBe(0); // 780 min × 0
        expect(r.flagged).toBe(false);
    });

    it("a small machine-close fix is free too", () => {
        const r = editSignificance(
            { arrivedAt: at(14), departedAt: at(20), arrivedVia: "SCANNER", departedVia: "SYSTEM" },
            { arrivedAt: at(14), departedAt: at(18) },
        );
        expect(r.flagged).toBe(false);
    });

    it("15-min shift of a roster-marked (SYSTEM pair) visit — small delta, not flagged", () => {
        const r = editSignificance(
            { arrivedAt: at(14), departedAt: at(16), arrivedVia: "SYSTEM", departedVia: "SYSTEM" },
            { arrivedAt: at(14, 15), departedAt: at(16, 15) },
        );
        expect(r.flagged).toBe(false); // (15+15) × 2 = 60 < 90
    });

    it("moving a SCANNER arrival 2h — overwrites a measurement, flagged", () => {
        const r = editSignificance(
            { arrivedAt: at(14), departedAt: at(16), arrivedVia: "SCANNER", departedVia: "SCANNER" },
            { arrivedAt: at(12), departedAt: at(16) },
        );
        expect(r.flagged).toBe(true); // 120 × 3 = 360
    });

    it("a SYSTEM departure paired with a SYSTEM arrival is a roster mark, not an auto-close", () => {
        const rosterPair = editSignificance(
            { arrivedAt: at(14), departedAt: at(16), arrivedVia: "SYSTEM", departedVia: "SYSTEM" },
            { arrivedAt: at(14), departedAt: at(17) },
        );
        expect(rosterPair.score).toBe(120); // 60 min × 2, not × 0.25
    });

    it("closing an own open visit — the routine correction — does not flag", () => {
        const r = editSignificance(
            { arrivedAt: at(14), departedAt: null, arrivedVia: "WEB", departedVia: null },
            { arrivedAt: at(14), departedAt: at(16) },
        );
        expect(r.flagged).toBe(false);
    });
});

describe("deleteSignificance", () => {
    it("always flags, whatever the source — the delete floor", () => {
        expect(deleteSignificance(
            { arrivedAt: at(14), departedAt: at(14, 30), arrivedVia: "WEB", departedVia: "WEB" },
        ).flagged).toBe(true);
        expect(deleteSignificance(
            { arrivedAt: at(14), departedAt: null, arrivedVia: "WEB", departedVia: null },
        ).flagged).toBe(true);
    });

    it("scores by erased duration times the strongest source weight", () => {
        const r = deleteSignificance(
            { arrivedAt: at(14), departedAt: at(16), arrivedVia: "SCANNER", departedVia: "SCANNER" },
        );
        expect(r.score).toBe(360);
    });
});
