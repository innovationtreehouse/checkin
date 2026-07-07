/**
 * Unit tests for the Google Directory client (lib/googleGroups.ts). Mirrors
 * shopify.test.ts: mock global.fetch, drive env vars live (config reads them per
 * call). A real RSA keypair is generated so the JWT-bearer assertion actually
 * signs; we then assert its SHAPE loosely (3 segments, RS256 header, jwt-bearer
 * grant) rather than verifying the signature against Google.
 */
import crypto from "crypto";
import {
    listGroupMembers,
    addGroupMember,
    removeGroupMember,
    resetTokenCache,
    GoogleGroupsError,
} from "../googleGroups";

const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const SA_JSON = JSON.stringify({ client_email: "sa@proj.iam.gserviceaccount.com", private_key: privateKey });
const GROUP = "robotics-2026@example.org";

let fetchMock: jest.Mock;
let originalEnv: NodeJS.ProcessEnv;

/** First call in every write/list is the token exchange — stub it. */
function mockTokenResponse() {
    fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "ya29.test-token", expires_in: 3599 }),
    });
}

beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.GOOGLE_SA_KEY_JSON = SA_JSON;
    process.env.GOOGLE_SA_SUBJECT = "admin@example.org";
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.clearAllMocks();
    resetTokenCache();
});

afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
});

function decodeSegment(seg: string): Record<string, unknown> {
    return JSON.parse(Buffer.from(seg, "base64url").toString());
}

describe("JWT-bearer token exchange", () => {
    it("posts a well-formed RS256 assertion to the Google token endpoint", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ members: [] }) }); // list

        await listGroupMembers(GROUP);

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe("https://oauth2.googleapis.com/token");
        const params = new URLSearchParams((init as RequestInit).body as string);
        expect(params.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");

        const assertion = params.get("assertion")!;
        const segments = assertion.split(".");
        expect(segments).toHaveLength(3);
        expect(decodeSegment(segments[0])).toEqual({ alg: "RS256", typ: "JWT" });
        const claims = decodeSegment(segments[1]);
        expect(claims.iss).toBe("sa@proj.iam.gserviceaccount.com");
        expect(claims.sub).toBe("admin@example.org"); // impersonated admin (DWD)
        expect(claims.scope).toContain("admin.directory.group.member");
        expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
    });

    it("caches the token across calls (one exchange for two operations)", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // add
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) }); // add again

        await addGroupMember(GROUP, "a@example.org");
        await addGroupMember(GROUP, "b@example.org");

        const tokenCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("/token"));
        expect(tokenCalls).toHaveLength(1);
    });

    it("throws GoogleGroupsError when the token exchange fails", async () => {
        fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => "invalid_grant" });
        await expect(addGroupMember(GROUP, "a@example.org")).rejects.toBeInstanceOf(GoogleGroupsError);
    });
});

describe("unconfigured (integration OFF)", () => {
    it("throws a clear error when creds are absent (no network)", async () => {
        delete process.env.GOOGLE_SA_KEY_JSON;
        delete process.env.GOOGLE_SA_SUBJECT;
        await expect(addGroupMember(GROUP, "a@example.org")).rejects.toThrow(/not configured/i);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("addGroupMember", () => {
    it("POSTs the member with role MEMBER", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });

        await addGroupMember(GROUP, "kid@example.org");

        const [url, init] = fetchMock.mock.calls[1];
        expect(String(url)).toContain(`/groups/${encodeURIComponent(GROUP)}/members`);
        expect((init as RequestInit).method).toBe("POST");
        expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: "kid@example.org", role: "MEMBER" });
    });

    it("treats 409 (already a member) as success — idempotent", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: false, status: 409, text: async () => "Member already exists." });
        await expect(addGroupMember(GROUP, "dup@example.org")).resolves.toBeUndefined();
    });

    it("throws on a real failure (e.g. 403)", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "forbidden" });
        await expect(addGroupMember(GROUP, "x@example.org")).rejects.toBeInstanceOf(GoogleGroupsError);
    });
});

describe("removeGroupMember", () => {
    it("DELETEs the member", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: true, status: 204, text: async () => "" });

        await removeGroupMember(GROUP, "gone@example.org");

        const [url, init] = fetchMock.mock.calls[1];
        expect(String(url)).toContain(`/members/${encodeURIComponent("gone@example.org")}`);
        expect((init as RequestInit).method).toBe("DELETE");
    });

    it("treats 404 (not a member) as success — idempotent", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "Resource Not Found" });
        await expect(removeGroupMember(GROUP, "missing@example.org")).resolves.toBeUndefined();
    });

    it("throws on a real failure (e.g. 500)", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "boom" });
        await expect(removeGroupMember(GROUP, "x@example.org")).rejects.toBeInstanceOf(GoogleGroupsError);
    });
});

describe("listGroupMembers", () => {
    it("paginates and returns lowercased email + role", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                members: [{ email: "Owner@Example.org", role: "OWNER" }, { email: "A@Example.org", role: "MEMBER" }],
                nextPageToken: "page2",
            }),
        });
        fetchMock.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ members: [{ email: "B@Example.org", role: "MEMBER" }] }),
        });

        const members = await listGroupMembers(GROUP);

        expect(members).toEqual([
            { email: "owner@example.org", role: "OWNER" },
            { email: "a@example.org", role: "MEMBER" },
            { email: "b@example.org", role: "MEMBER" },
        ]);
        // token + 2 pages
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(String(fetchMock.mock.calls[2][0])).toContain("pageToken=page2");
    });

    it("throws GoogleGroupsError when the list call fails", async () => {
        mockTokenResponse();
        fetchMock.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "no such group" });
        await expect(listGroupMembers(GROUP)).rejects.toBeInstanceOf(GoogleGroupsError);
    });
});
