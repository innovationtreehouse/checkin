import { getServerSession } from "next-auth/next";
import { assertDevActor } from "../guard";
import { ORG_DOMAIN } from "@/lib/config";

// assertDevActor wires three I/O edges: env (CHECKIN_ENV), the current session, and notFound().
// We mock the session + notFound and drive CHECKIN_ENV via process.env (config reads it per call),
// and avoid pulling the real auth-options graph (prisma etc.) into the unit test.
jest.mock("next-auth/next", () => ({ getServerSession: jest.fn() }));
jest.mock("next/navigation", () => ({
    notFound: jest.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
    }),
}));
jest.mock("@/lib/auth-options", () => ({ authOptions: {} }));

const mockedSession = getServerSession as unknown as jest.Mock;

function setEnv(v?: string) {
    if (v === undefined) delete process.env.CHECKIN_ENV;
    else process.env.CHECKIN_ENV = v;
}

const orgUser = { email: "daniel@innovationtreehouse.org", hd: ORG_DOMAIN, emailVerified: true };

describe("assertDevActor", () => {
    const originalEnv = process.env.CHECKIN_ENV;
    afterEach(() => jest.clearAllMocks());
    afterAll(() => setEnv(originalEnv));

    describe("prod (and unset → prod)", () => {
        it("always 404s, even with a valid org session", async () => {
            setEnv("prod");
            mockedSession.mockResolvedValue({ user: orgUser });
            await expect(assertDevActor()).rejects.toThrow("NEXT_NOT_FOUND");
        });
        it("treats unset CHECKIN_ENV as prod (fail-safe)", async () => {
            setEnv(undefined);
            mockedSession.mockResolvedValue({ user: orgUser });
            await expect(assertDevActor()).rejects.toThrow("NEXT_NOT_FOUND");
        });
    });

    describe("dev", () => {
        beforeEach(() => setEnv("dev"));

        it("allows a verified org member and returns their email", async () => {
            mockedSession.mockResolvedValue({ user: orgUser });
            await expect(assertDevActor()).resolves.toBe("daniel@innovationtreehouse.org");
        });

        it("returns the REAL human (impersonatedBy) when impersonating", async () => {
            mockedSession.mockResolvedValue({
                user: { email: "jane@example.com", hd: ORG_DOMAIN, emailVerified: true, impersonatedBy: "daniel@innovationtreehouse.org" },
            });
            await expect(assertDevActor()).resolves.toBe("daniel@innovationtreehouse.org");
        });

        it("404s a non-org caller", async () => {
            mockedSession.mockResolvedValue({ user: { email: "x@gmail.com", hd: null, emailVerified: true } });
            await expect(assertDevActor()).rejects.toThrow("NEXT_NOT_FOUND");
        });

        it("404s an unverified org caller", async () => {
            mockedSession.mockResolvedValue({ user: { email: "x@innovationtreehouse.org", hd: ORG_DOMAIN, emailVerified: false } });
            await expect(assertDevActor()).rejects.toThrow("NEXT_NOT_FOUND");
        });

        it("404s an anonymous caller", async () => {
            mockedSession.mockResolvedValue(null);
            await expect(assertDevActor()).rejects.toThrow("NEXT_NOT_FOUND");
        });
    });

    describe("local", () => {
        beforeEach(() => setEnv("local"));

        it("allows even without org claims, crediting the email", async () => {
            mockedSession.mockResolvedValue({ user: { email: "me@example.com", hd: null, emailVerified: false } });
            await expect(assertDevActor()).resolves.toBe("me@example.com");
        });

        it("credits the real human when impersonating locally", async () => {
            mockedSession.mockResolvedValue({ user: { email: "jane@example.com", impersonatedBy: "me@example.com" } });
            await expect(assertDevActor()).resolves.toBe("me@example.com");
        });

        it('falls back to "local" when there is no session at all', async () => {
            mockedSession.mockResolvedValue(null);
            await expect(assertDevActor()).resolves.toBe("local");
        });
    });
});
