/**
 * The last-keyholder warning is rendered on the kiosk screen. `Person.email` is
 * tier `pii`, so a person with no `name` must degrade to the email local-part —
 * never the full address (#329).
 */
import type { Person } from "@/generated/prisma/client";
import type { DbClient } from "@/lib/db-client";
import { processCheckout } from "@/lib/scan-service";

jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/notifications", () => ({ sendCheckinNotifications: jest.fn() }));

const keyholder = { id: 1, isKeyholder: true } as Person;

/** Tx-shaped fake (no `$transaction`, so isRootClient() is false). */
function fakeDb(remaining: Array<{ name: string | null; email: string | null }>): DbClient {
    return {
        visit: {
            count: jest.fn().mockResolvedValue(0), // no other keyholders present
            findMany: jest.fn().mockResolvedValue(
                remaining.map((person, i) => ({ id: 100 + i, person }))
            ),
        },
        rawBadgeLog: { findMany: jest.fn().mockResolvedValue([]) }, // no double-badge confirm
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
