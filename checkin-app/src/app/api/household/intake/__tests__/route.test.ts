/**
 * @jest-environment node
 *
 * Program-context household intake route (auth-first registration, PR C). It is
 * a thin, PROCESS-FREE wrapper over the membership intake service: it must save
 * to / read from the caller's OWN household (saveIntake/getIntakeState always
 * take the session user's id) and must NEVER open or advance an
 * OrgMembershipProcess (startIntake/submitIntake). Mocks the service + session
 * the way participantPiiMinimization.test.ts does, so it runs in the default
 * suite with no live DB.
 */

import type { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { getKioskPublicKeys, verifyKioskSignature } from "@/lib/verify-kiosk";
import * as intake from "@/lib/membership/intake";
import { GET, POST } from "@/app/api/household/intake/route";

jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("@/lib/auth-options", () => ({ authOptions: {} }));
jest.mock("@/lib/verify-kiosk", () => ({
    getKioskPublicKeys: jest.fn(),
    verifyKioskSignature: jest.fn(),
}));
jest.mock("@/lib/membership/intake", () => ({
    __esModule: true,
    getIntakeState: jest.fn(),
    saveIntake: jest.fn(),
    // Present so the process-free assertions below can prove they're untouched.
    startIntake: jest.fn(),
    submitIntake: jest.fn(),
    IntakeError: class IntakeError extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    },
}));

const mockSession = getServerSession as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    (getKioskPublicKeys as jest.Mock).mockReturnValue([]);
    (verifyKioskSignature as jest.Mock).mockReturnValue({ ok: false });
    mockSession.mockResolvedValue(null);
});

function jsonReq(body: unknown): NextRequest {
    return new Request("http://localhost/api/household/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    }) as unknown as NextRequest;
}

describe("GET /api/household/intake", () => {
    it("returns the caller's own intake state, process-free", async () => {
        mockSession.mockResolvedValue({ user: { id: 7 } });
        (intake.getIntakeState as jest.Mock).mockResolvedValue({ hasHousehold: true, prefill: { children: [] } });

        const req = new Request("http://localhost/api/household/intake") as unknown as NextRequest;
        const res = await GET(req);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ hasHousehold: true, prefill: { children: [] } });
        // Scoped to the session user — never a client-supplied id.
        expect(intake.getIntakeState).toHaveBeenCalledWith(7);
        expect(intake.startIntake).not.toHaveBeenCalled();
        expect(intake.submitIntake).not.toHaveBeenCalled();
    });

    it("rejects an unauthenticated caller with 401", async () => {
        mockSession.mockResolvedValue(null);
        const req = new Request("http://localhost/api/household/intake") as unknown as NextRequest;
        const res = await GET(req);
        expect(res.status).toBe(401);
        expect(intake.getIntakeState).not.toHaveBeenCalled();
    });
});

describe("POST /api/household/intake", () => {
    it("saves to the caller's own household and never touches a membership process", async () => {
        mockSession.mockResolvedValue({ user: { id: 7 } });
        (intake.saveIntake as jest.Mock).mockResolvedValue({ state: { ok: true }, rejections: [] });

        // A malicious body cannot redirect the save at another household: the
        // route passes the SESSION id, ignoring any id in the payload.
        const res = await POST(jsonReq({ primaryParent: { name: "Me" }, userId: 999 }));

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ state: { ok: true }, rejections: [] });
        expect(intake.saveIntake).toHaveBeenCalledWith(7, { primaryParent: { name: "Me" }, userId: 999 });
        expect(intake.startIntake).not.toHaveBeenCalled();
        expect(intake.submitIntake).not.toHaveBeenCalled();
    });

    it("rejects an unauthenticated caller with 401", async () => {
        mockSession.mockResolvedValue(null);
        const res = await POST(jsonReq({ primaryParent: { name: "Me" } }));
        expect(res.status).toBe(401);
        expect(intake.saveIntake).not.toHaveBeenCalled();
    });
});
