/**
 * @jest-environment node
 */
/**
 * Unit tests for usesProgramMemberCode (lib/finance/reconcile.ts) — the program
 * member-discount-code entitlement predicate. The integration matrix drives it
 * through runReconcile against a real DB, but that suite is not in the default
 * jest run; this pins the predicate itself in default CI. Heavy reconcile deps are
 * mocked away — the predicate is pure.
 */
import type { MirrorOrder } from "@/lib/shopifyRead/client";

jest.mock("@/lib/prisma", () => ({ __esModule: true, default: {} }));
jest.mock("@/lib/membership/payment", () => ({ activateByProcessId: jest.fn() }));
jest.mock("@/lib/membership/boardAlerts", () => ({ notifyBoardPaymentException: jest.fn() }));
jest.mock("@/lib/orgMembership", () => ({
    isDuesSettledThroughMany: jest.fn(),
    programCoverageDate: jest.fn(),
}));
jest.mock("@/lib/shopifyRead/client", () => ({}));

import { usesProgramMemberCode } from "../reconcile";

const order = (discountCodes: string[]) => ({ discountCodes } as MirrorOrder);

describe("usesProgramMemberCode", () => {
    it("flags a minted code for the given program", () => {
        expect(usesProgramMemberCode(order(["PRG42-ABCD1234"]), 42)).toBe(true);
    });

    it("compares case-insensitively — Shopify codes are case-insensitive", () => {
        expect(usesProgramMemberCode(order(["prg42-abcd1234"]), 42)).toBe(true);
    });

    it("tolerates surrounding whitespace", () => {
        expect(usesProgramMemberCode(order([" PRG42-ABCD1234 "]), 42)).toBe(true);
    });

    it("ignores a code minted for a different program", () => {
        expect(usesProgramMemberCode(order(["PRG7-ABCD1234"]), 42)).toBe(false);
    });

    it("the trailing hyphen guards against adjacent-id prefix collisions (PRG4 vs PRG42)", () => {
        // Program 4's code must not match when asking about 42, and vice versa — a
        // bare `startsWith("PRG42")` (no hyphen) would wrongly match "PRG420-..." /
        // let "PRG4-..." satisfy a "PRG42" prefix check via string concatenation.
        expect(usesProgramMemberCode(order(["PRG42-ABCD1234"]), 4)).toBe(false);
        expect(usesProgramMemberCode(order(["PRG4-ABCD1234"]), 42)).toBe(false);
    });

    it("ignores unrelated codes — promos are Shopify's business, not checkin's", () => {
        expect(usesProgramMemberCode(order(["SUMMER26"]), 42)).toBe(false);
        expect(usesProgramMemberCode(order(["VOLFAM"]), 42)).toBe(false);
    });

    it("an empty code list never flags (parity with usesVolunteerCodeUnentitled)", () => {
        expect(usesProgramMemberCode(order([]), 42)).toBe(false);
    });
});
