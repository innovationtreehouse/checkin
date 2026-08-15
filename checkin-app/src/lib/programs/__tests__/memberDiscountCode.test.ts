/**
 * @jest-environment node
 */
/**
 * Unit tests for the program member-discount-code helpers: the code-format
 * predicate and the money-event entitlement judgement both the orders/paid webhook
 * and the reconciler's forward pass call. The integration matrices drive them
 * through the real routes against a real DB; those suites are not in the default
 * jest run, so this pins the logic itself in default CI.
 */
jest.mock("@/lib/prisma", () => ({
    __esModule: true,
    default: { program: { findUnique: jest.fn() } },
}));
jest.mock("@/lib/orgMembership", () => ({
    isDuesSettledThrough: jest.fn(),
    programCoverageDate: (p: { startAt: Date | null; endAt: Date | null }) => p.endAt ?? p.startAt ?? null,
}));

import prisma from "@/lib/prisma";
import { isDuesSettledThrough } from "@/lib/orgMembership";
import { usesProgramMemberCode, unentitledMemberCodeUse } from "../memberDiscountCode";

const findUnique = prisma.program.findUnique as jest.Mock;
const settledThrough = isDuesSettledThrough as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ startAt: new Date("2026-06-01"), endAt: new Date("2026-08-01") });
});

describe("usesProgramMemberCode", () => {
    it("flags a minted code for the given program", () => {
        expect(usesProgramMemberCode(["PRG42-ABCD1234"], 42)).toBe(true);
    });

    it("compares case-insensitively — Shopify codes are case-insensitive", () => {
        expect(usesProgramMemberCode(["prg42-abcd1234"], 42)).toBe(true);
    });

    it("tolerates surrounding whitespace", () => {
        expect(usesProgramMemberCode([" PRG42-ABCD1234 "], 42)).toBe(true);
    });

    it("ignores a code minted for a different program", () => {
        expect(usesProgramMemberCode(["PRG7-ABCD1234"], 42)).toBe(false);
    });

    it("the trailing hyphen guards against adjacent-id prefix collisions (PRG4 vs PRG42)", () => {
        // A bare `startsWith("PRG42")` would wrongly match "PRG420-..." / let
        // "PRG4-..." satisfy a "PRG42" prefix check via string concatenation.
        expect(usesProgramMemberCode(["PRG42-ABCD1234"], 4)).toBe(false);
        expect(usesProgramMemberCode(["PRG4-ABCD1234"], 42)).toBe(false);
    });

    it("ignores unrelated codes — promos are Shopify's business, not checkin's", () => {
        expect(usesProgramMemberCode(["SUMMER26"], 42)).toBe(false);
        expect(usesProgramMemberCode(["VOLFAM"], 42)).toBe(false);
    });

    it("an empty code list never flags (parity with usesVolunteerCodeUnentitled)", () => {
        expect(usesProgramMemberCode([], 42)).toBe(false);
    });
});

describe("unentitledMemberCodeUse", () => {
    it("flags when the order carries the program's code and no enrollee is dues-settled", async () => {
        settledThrough.mockResolvedValue(false);
        expect(await unentitledMemberCodeUse(42, [1, 2], ["PRG42-ABCD1234"])).toBe(true);
        expect(settledThrough).toHaveBeenCalledTimes(2);
    });

    it("does not flag when SOME enrollee's household is dues-settled through the coverage date", async () => {
        settledThrough.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
        expect(await unentitledMemberCodeUse(42, [1, 2], ["PRG42-ABCD1234"])).toBe(false);
    });

    it("asks entitlement against the program's coverage date (endAt), not today", async () => {
        settledThrough.mockResolvedValue(true);
        await unentitledMemberCodeUse(42, [1], ["PRG42-ABCD1234"]);
        expect(settledThrough).toHaveBeenCalledWith(1, new Date("2026-08-01"));
    });

    it("never judges an order that does not carry this program's code — no entitlement query at all", async () => {
        settledThrough.mockResolvedValue(false);
        expect(await unentitledMemberCodeUse(42, [1], [])).toBe(false);
        expect(await unentitledMemberCodeUse(42, [1], ["SUMMER26"])).toBe(false);
        expect(await unentitledMemberCodeUse(42, [1], ["PRG7-ABCD1234"])).toBe(false);
        expect(settledThrough).not.toHaveBeenCalled();
        expect(findUnique).not.toHaveBeenCalled();
    });

    it("a program with no dates asks the status-only question (through = null)", async () => {
        findUnique.mockResolvedValue({ startAt: null, endAt: null });
        settledThrough.mockResolvedValue(false);
        expect(await unentitledMemberCodeUse(42, [1], ["PRG42-ABCD1234"])).toBe(true);
        expect(settledThrough).toHaveBeenCalledWith(1, null);
    });
});
