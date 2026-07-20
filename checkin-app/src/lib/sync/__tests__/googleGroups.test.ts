/**
 * @jest-environment node
 */
/**
 * Unit tests for the Google Directory client (spec §4.1). Stubbed fetch injected
 * via deps — no real network, no real DB. Partial config mock (gotcha §11): this
 * module reaches config.googleDirectoryConfigured()/SaKey()/AdminSubject().
 */

import crypto from "crypto";
import { getGoogleDirectoryClient, mintDirectoryAccessToken, resetDirectoryTokenCache } from "@/lib/sync/googleGroups";

jest.mock("@/lib/config", () => {
    const actual = jest.requireActual("@/lib/config");
    return {
        __esModule: true,
        ...actual,
        config: {
            ...actual.config,
            googleDirectorySaKey: jest.fn(() => null),
            googleDirectoryAdminSubject: jest.fn(() => null),
            googleDirectoryConfigured: jest.fn(() => false),
        },
    };
});
import { config } from "@/lib/config";

const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
});
const SA = { client_email: "test-sa@example.iam.gserviceaccount.com", private_key: privateKey };
const FAKE_SA_KEY = JSON.stringify(SA);

function jsonRes(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), statusText: `status ${status}` };
}

function mockTokenExchange(fetchMock: jest.Mock) {
    fetchMock.mockResolvedValueOnce(jsonRes(200, { access_token: "tok", expires_in: 3600 }));
}

beforeEach(() => {
    resetDirectoryTokenCache();
    (config.googleDirectorySaKey as jest.Mock).mockReturnValue(null);
    (config.googleDirectoryAdminSubject as jest.Mock).mockReturnValue(null);
    (config.googleDirectoryConfigured as jest.Mock).mockReturnValue(false);
});

describe("getGoogleDirectoryClient", () => {
    it("returns null when unconfigured", () => {
        expect(getGoogleDirectoryClient()).toBeNull();
    });

    it("returns null when the SA key JSON is malformed (fail closed, same as unconfigured)", () => {
        (config.googleDirectoryConfigured as jest.Mock).mockReturnValue(true);
        (config.googleDirectorySaKey as jest.Mock).mockReturnValue("not json");
        (config.googleDirectoryAdminSubject as jest.Mock).mockReturnValue("admin@example.com");
        expect(getGoogleDirectoryClient()).toBeNull();
    });

    it("returns a working client when configured", async () => {
        (config.googleDirectoryConfigured as jest.Mock).mockReturnValue(true);
        (config.googleDirectorySaKey as jest.Mock).mockReturnValue(FAKE_SA_KEY);
        (config.googleDirectoryAdminSubject as jest.Mock).mockReturnValue("admin@example.com");

        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        fetchMock.mockResolvedValueOnce(jsonRes(200, {}));

        const client = getGoogleDirectoryClient({ fetchFn: fetchMock as unknown as typeof fetch });
        expect(client).not.toBeNull();
        const result = await client!.insertMember("group@example.com", "member@example.com");
        expect(result).toEqual({ ok: true });
    });
});

describe("insertMember / removeMember result mapping (money/security-adjacent tolerance branch)", () => {
    function buildClient(fetchMock: jest.Mock) {
        return getGoogleDirectoryClient({ fetchFn: fetchMock as unknown as typeof fetch });
    }

    beforeEach(() => {
        (config.googleDirectoryConfigured as jest.Mock).mockReturnValue(true);
        (config.googleDirectorySaKey as jest.Mock).mockReturnValue(FAKE_SA_KEY);
        (config.googleDirectoryAdminSubject as jest.Mock).mockReturnValue("admin@example.com");
    });

    it("insertMember: 200 -> ok:true (no alreadyInDesiredState)", async () => {
        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        fetchMock.mockResolvedValueOnce(jsonRes(200, {}));
        const result = await buildClient(fetchMock)!.insertMember("g@example.com", "m@example.com");
        expect(result).toEqual({ ok: true });
    });

    it("insertMember: 409 -> {ok:true, alreadyInDesiredState:true} (already a member)", async () => {
        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        fetchMock.mockResolvedValueOnce(jsonRes(409, { error: { message: "Member already exists" } }));
        const result = await buildClient(fetchMock)!.insertMember("g@example.com", "m@example.com");
        expect(result).toEqual({ ok: true, alreadyInDesiredState: true });
    });

    it("insertMember: 403 -> ok:false with status + error, never throws", async () => {
        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        fetchMock.mockResolvedValueOnce(jsonRes(403, { error: { message: "Not authorized" } }));
        const result = await buildClient(fetchMock)!.insertMember("g@example.com", "m@example.com");
        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ status: 403, error: "Not authorized" });
    });

    it("insertMember: 500 -> ok:false with status + error, never throws", async () => {
        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        fetchMock.mockResolvedValueOnce(jsonRes(500, { error: { message: "backend error" } }));
        const result = await buildClient(fetchMock)!.insertMember("g@example.com", "m@example.com");
        expect(result.ok).toBe(false);
        expect(result).toMatchObject({ status: 500 });
    });

    it("removeMember: 404 -> {ok:true, alreadyInDesiredState:true} (already absent)", async () => {
        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        fetchMock.mockResolvedValueOnce(jsonRes(404, {}));
        const result = await buildClient(fetchMock)!.removeMember("g@example.com", "m@example.com");
        expect(result).toEqual({ ok: true, alreadyInDesiredState: true });
    });

    it("removeMember: 200 -> ok:true (no alreadyInDesiredState)", async () => {
        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        fetchMock.mockResolvedValueOnce(jsonRes(200, {}));
        const result = await buildClient(fetchMock)!.removeMember("g@example.com", "m@example.com");
        expect(result).toEqual({ ok: true });
    });
});

describe("mintDirectoryAccessToken", () => {
    it("produces a JWT with three dot-separated base64url segments", async () => {
        const fetchMock = jest.fn();
        let capturedAssertion = "";
        fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
            const params = new URLSearchParams(init.body as string);
            capturedAssertion = params.get("assertion") ?? "";
            return jsonRes(200, { access_token: "tok", expires_in: 3600 });
        });

        await mintDirectoryAccessToken(SA, "admin@example.com", fetchMock as unknown as typeof fetch);

        const segments = capturedAssertion.split(".");
        expect(segments).toHaveLength(3);
        for (const seg of segments) expect(seg).toMatch(/^[A-Za-z0-9_-]+$/); // base64url alphabet
        const header = JSON.parse(Buffer.from(segments[0], "base64url").toString());
        expect(header).toEqual({ alg: "RS256", typ: "JWT" });
        const claims = JSON.parse(Buffer.from(segments[1], "base64url").toString());
        expect(claims).toMatchObject({ iss: SA.client_email, sub: "admin@example.com", scope: "https://www.googleapis.com/auth/admin.directory.group.member" });
    });

    it("caches the token in-module until ~60s before expiry (no re-mint on a second call)", async () => {
        const fetchMock = jest.fn();
        mockTokenExchange(fetchMock);
        const first = await mintDirectoryAccessToken(SA, "admin@example.com", fetchMock as unknown as typeof fetch);
        const second = await mintDirectoryAccessToken(SA, "admin@example.com", fetchMock as unknown as typeof fetch);
        expect(first).toBe("tok");
        expect(second).toBe("tok");
        expect(fetchMock).toHaveBeenCalledTimes(1); // only one token-exchange call
    });
});
