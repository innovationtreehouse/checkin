/**
 * The last-keyholder warning is rendered on the kiosk screen. `Person.email` is
 * tier `pii`, so a person with no `name` must degrade to the email local-part —
 * never the full address (#329).
 *
 * The force close itself is bound to that warning: it proceeds only for a scan
 * echoing the confirm token minted with it, never for two badge events that
 * merely happen to be close together (B2 of #1529, §5.23).
 */
import type { Person } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db-client";
import { processCheckout, FORCE_CLOSE_CONFIRM_SECONDS } from "@/lib/scan-service";

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
    storedToken: string | null = null
): DbClient {
    return {
        visit: {
            count: jest.fn().mockResolvedValue(0), // no other keyholders present
            findMany: jest.fn().mockResolvedValue(
                remaining.map((person, i) => ({ id: 100 + i, person }))
            ),
            findUnique: jest.fn().mockResolvedValue({ forceCloseToken: storedToken }),
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

describe("force close is bound to the confirm token", () => {
    const present = [{ name: "Someone Inside", email: "inside@example.com" }];

    it("warns, mints a token, and hands it back with the countdown length", async () => {
        const db = fakeDb(present);
        const res = await processCheckout(keyholder, 42, "kiosk", db);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.facilityClosed).toBeUndefined();
        expect(body.forceCloseToken).toEqual(expect.any(String));
        expect(body.confirmSeconds).toBe(FORCE_CLOSE_CONFIRM_SECONDS);
        expect(body.error).toContain(`within ${FORCE_CLOSE_CONFIRM_SECONDS} seconds`);
        expect(db.visit.update).toHaveBeenCalledWith({
            where: { id: 42 },
            data: { forceCloseWarnedAt: expect.any(Date), forceCloseToken: body.forceCloseToken },
        });
    });

    it("closes the facility when the scan echoes the minted token", async () => {
        const db = fakeDb(present, "token-abc");
        const res = await processCheckout(keyholder, 42, "kiosk", db, "token-abc");

        expect(res.status).toBe(200);
        expect((await res.json()).facilityClosed).toBe(true);
    });

    it("honors a token minted before an outage — no elapsed-time gate (§5.23a)", async () => {
        // The visit was warned days ago; only the token match decides.
        const db = fakeDb(present, "token-from-tuesday");
        const res = await processCheckout(keyholder, 42, "kiosk", db, "token-from-tuesday");

        expect((await res.json()).facilityClosed).toBe(true);
    });

    it("re-warns with a NEW token when the scan carries no token", async () => {
        const db = fakeDb(present, "token-abc");
        const res = await processCheckout(keyholder, 42, "kiosk", db);
        const body = await res.json();

        expect(res.status).toBe(400);
        expect(body.type).toBe("warning");
        expect(body.forceCloseToken).not.toBe("token-abc");
    });

    it("re-warns rather than closing when the token does not match", async () => {
        const db = fakeDb(present, "token-abc");
        const res = await processCheckout(keyholder, 42, "kiosk", db, "token-guessed");

        expect(res.status).toBe(400);
        expect((await res.json()).type).toBe("warning");
    });
});
