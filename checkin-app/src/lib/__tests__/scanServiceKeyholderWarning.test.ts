/**
 * The last-keyholder warning is rendered on the kiosk screen. `Person.email` is
 * tier `pii`, so a person with no `name` must degrade to the email local-part —
 * never the full address (#329).
 *
 * The force close itself is bound to that warning: it proceeds only for a scan
 * that follows a fresh `Visit.forceCloseWarnedAt` stamp, never for two badge
 * events that merely happen to be close together (B2 of #1529).
 */
import type { Person } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db-client";
import { processCheckout } from "@/lib/scan-service";

jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/notifications", () => ({
    sendCheckinNotifications: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/attendanceTransitions", () => ({
    findAssociatedEventAt: jest.fn().mockResolvedValue(null),
    processVisitCheckout: jest.fn().mockResolvedValue([]),
}));

const keyholder = { id: 1, isKeyholder: true } as Person;

/** Tx-shaped fake (no `$transaction`, so isRootClient() is false). */
function fakeDb(
    remaining: Array<{ name: string | null; email: string | null }>,
    warnedAt: Date | null = null
): DbClient {
    return {
        visit: {
            count: jest.fn().mockResolvedValue(0), // no other keyholders present
            findMany: jest.fn().mockResolvedValue(
                remaining.map((person, i) => ({ id: 100 + i, person }))
            ),
            findUnique: jest.fn().mockResolvedValue({ forceCloseWarnedAt: warnedAt }),
            update: jest.fn().mockResolvedValue({}),
        },
        rawBadgeLog: {
            update: jest.fn().mockResolvedValue({}),
        },
    } as unknown as DbClient;
}

async function warningFor(remaining: Array<{ name: string | null; email: string | null }>) {
    const res = await processCheckout(keyholder, 42, "kiosk", fakeDb(remaining));
    expect(res.status).toBe(400);
    return (await res.json()) as { error: string; type: string };
}

it("renders a nameless person as the email local-part, not the address", async () => {
    const body = await warningFor([{ name: null, email: "jane.doe@example.com" }]);

    expect(body.type).toBe("warning");
    expect(body.error).toContain("jane.doe");
    expect(body.error).not.toContain("@");
    expect(body.error).not.toContain("example.com");
});

it("prefers the name when set, and mixes both without leaking", async () => {
    const body = await warningFor([
        { name: "Alex Rivera", email: "arivera@example.com" },
        { name: "   ", email: "blank.name@example.com" },
    ]);

    expect(body.error).toContain("Alex Rivera, blank.name");
    expect(body.error).not.toContain("@");
});

it("omits a person with neither name nor email rather than rendering an empty slot", async () => {
    const body = await warningFor([
        { name: null, email: null },
        { name: null, email: "solo@example.com" },
    ]);

    expect(body.error).toContain("solo");
    expect(body.error).not.toMatch(/, ,|:\n, /);
});

describe("force close is bound to the warning", () => {
    const present = [{ name: "Someone Inside", email: "inside@example.com" }];

    it("warns and stamps the visit when no warning has been shown yet", async () => {
        const db = fakeDb(present);
        const res = await processCheckout(keyholder, 42, "kiosk", db);

        expect(res.status).toBe(400);
        expect((await res.json()).facilityClosed).toBeUndefined();
        expect(db.visit.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: { forceCloseWarnedAt: expect.any(Date) },
        });
    });

    it("closes the facility when the scan follows a fresh warning stamp", async () => {
        const db = fakeDb(present, new Date(Date.now() - 8000));
        const res = await processCheckout(keyholder, 42, "kiosk", db);

        expect(res.status).toBe(200);
        expect((await res.json()).facilityClosed).toBe(true);
    });

    it("warns again when the stamp has expired", async () => {
        const db = fakeDb(present, new Date(Date.now() - 5 * 60_000));
        const res = await processCheckout(keyholder, 42, "kiosk", db);

        expect(res.status).toBe(400);
        expect((await res.json()).type).toBe("warning");
    });
});

describe("F1: replay must not be able to force-close (§4 phase gate)", () => {
    const present = [{ name: "Someone Inside", email: "inside@example.com" }];

    it("a replayed checkout parks instead of warning/confirming, never touching forceCloseWarnedAt", async () => {
        const db = fakeDb(present);
        const res = await processCheckout(keyholder, 42, "kiosk", db, new Date(), "evt-replay-1");

        expect(res.status).toBe(200);
        expect((await res.json()).type).toBe("parked");
        expect(db.visit.findUnique).not.toHaveBeenCalled();
        expect(db.visit.update).not.toHaveBeenCalled();
        expect(db.rawBadgeLog.update).toHaveBeenCalledWith({
            where: { clientEventId: "evt-replay-1" },
            data: { reviewReason: "force_close_review" },
        });
    });

    it("two replayed keyholder checkouts do NOT close all open visits -- the second also parks", async () => {
        const db = fakeDb(present);

        const first = await processCheckout(keyholder, 42, "kiosk", db, new Date(), "evt-replay-1");
        expect((await first.json()).type).toBe("parked");

        const second = await processCheckout(keyholder, 42, "kiosk", db, new Date(), "evt-replay-2");
        expect((await second.json()).type).toBe("parked");

        // Neither replay ever stamped or read forceCloseWarnedAt, so nothing
        // was ever in a position to "confirm" and sweep the room.
        expect(db.visit.update).not.toHaveBeenCalled();
    });
});
