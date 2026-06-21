/**
 * @jest-environment node
 */
import {
    getAccessToken,
    createRequest,
    getEmbeddedSignUrl,
    ZohoError,
    _resetTokenCache,
} from "@/lib/membership/contract/zohoClient";

const ORIGINAL_ENV = { ...process.env };

function mockFetchOnce(body: unknown, ok = true, status = 200) {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body),
    });
}

describe("zohoClient", () => {
    beforeEach(() => {
        process.env.ZOHO_CLIENT_ID = "cid";
        process.env.ZOHO_CLIENT_SECRET = "csecret";
        process.env.ZOHO_REFRESH_TOKEN = "rtoken";
        delete process.env.ZOHO_ACCOUNTS_URL;
        delete process.env.ZOHO_SIGN_API;
        _resetTokenCache();
        global.fetch = jest.fn();
    });
    afterAll(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it("caches the access token across calls (one token exchange)", async () => {
        mockFetchOnce({ access_token: "tok-123", expires_in: 3600 });
        const a = await getAccessToken();
        const b = await getAccessToken();
        expect(a).toBe("tok-123");
        expect(b).toBe("tok-123");
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("throws ZohoError when OAuth secrets are missing", async () => {
        delete process.env.ZOHO_REFRESH_TOKEN;
        await expect(getAccessToken()).rejects.toBeInstanceOf(ZohoError);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it("createRequest returns request/action/document ids on success", async () => {
        mockFetchOnce({
            status: "success",
            requests: {
                request_id: "req-1",
                actions: [{ action_id: "act-1" }],
                document_ids: [{ document_id: "doc-1" }],
            },
        });
        const result = await createRequest({
            token: "t",
            pdf: Buffer.from("%PDF-1.4 fake"),
            filename: "a.pdf",
            recipientEmail: "x@example.com",
            recipientName: "X",
            requestName: "Agreement",
            expirationDays: 15,
        });
        expect(result).toEqual({ requestId: "req-1", actionId: "act-1", documentId: "doc-1" });
    });

    it("createRequest throws when Zoho reports a non-success status", async () => {
        mockFetchOnce({ status: "failure", message: "nope" });
        await expect(
            createRequest({
                token: "t",
                pdf: Buffer.from("x"),
                filename: "a.pdf",
                recipientEmail: "x@example.com",
                recipientName: "X",
                requestName: "Agreement",
                expirationDays: 15,
            }),
        ).rejects.toBeInstanceOf(ZohoError);
    });

    it("getEmbeddedSignUrl returns the sign_url and passes host", async () => {
        mockFetchOnce({ sign_url: "https://sign.zoho.com/embed/abc" });
        const url = await getEmbeddedSignUrl({ token: "t", requestId: "req-1", actionId: "act-1", host: "https://app.example.com" });
        expect(url).toBe("https://sign.zoho.com/embed/abc");
        const calledUrl = (global.fetch as jest.Mock).mock.calls[0][0] as URL;
        expect(calledUrl.toString()).toContain("/requests/req-1/actions/act-1/embedtoken");
        expect(calledUrl.searchParams.get("host")).toBe("https://app.example.com");
    });
});
