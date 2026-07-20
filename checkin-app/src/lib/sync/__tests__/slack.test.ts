/**
 * @jest-environment node
 */
/**
 * Unit tests for the Slack Web API client (spec §4.2, REVIEW ADDENDUM A2's
 * removeFromChannel). Stubbed fetch injected via deps — no real network, no config
 * dependency (token is passed directly, not read from env).
 */

import { getSlackClient } from "@/lib/sync/slack";

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
        json: async () => body,
    };
}

describe("getSlackClient", () => {
    it("returns null when no bot token is given", () => {
        expect(getSlackClient(null)).toBeNull();
    });
});

describe("lookupByEmail", () => {
    it("users_not_found -> {ok:false, notFound:true}", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: false, error: "users_not_found" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.lookupByEmail("nobody@example.com");
        expect(result).toEqual({ ok: false, notFound: true });
    });

    it("found -> {ok:true, userId}", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: true, user: { id: "U123" } }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.lookupByEmail("someone@example.com");
        expect(result).toEqual({ ok: true, userId: "U123" });
    });

    it("some other error -> {ok:false, notFound:false, error}", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: false, error: "invalid_auth" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.lookupByEmail("someone@example.com");
        expect(result).toEqual({ ok: false, notFound: false, error: "invalid_auth" });
    });
});

describe("inviteToChannel", () => {
    it("already_in_channel is tolerated as alreadyInDesiredState", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: false, error: "already_in_channel" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.inviteToChannel("C1", ["U1"]);
        expect(result).toEqual({ ok: true, alreadyInDesiredState: true });
    });

    it("cant_invite_self is tolerated as alreadyInDesiredState", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: false, error: "cant_invite_self" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.inviteToChannel("C1", ["U1"]);
        expect(result).toEqual({ ok: true, alreadyInDesiredState: true });
    });

    it("a real (non-tolerated) error surfaces as ok:false", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: false, error: "channel_not_found" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.inviteToChannel("C1", ["U1"]);
        expect(result.ok).toBe(false);
    });

    it("success -> ok:true (no alreadyInDesiredState)", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: true }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.inviteToChannel("C1", ["U1"]);
        expect(result).toEqual({ ok: true });
    });

    it("429 -> ok:false with retryAfterMs from the Retry-After header", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(429, { ok: false, error: "ratelimited" }, { "retry-after": "5" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.inviteToChannel("C1", ["U1"]);
        expect(result).toEqual({ ok: false, error: "ratelimited", retryAfterMs: 5000 });
    });

    it("batches >30 ids into multiple calls", async () => {
        const fetchMock = jest.fn().mockResolvedValue(jsonRes(200, { ok: true }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const ids = Array.from({ length: 35 }, (_, i) => `U${i}`);
        const result = await client!.inviteToChannel("C1", ids);
        expect(result.ok).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2); // 30 + 5
        const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
        const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
        expect((firstBody.users as string).split(",")).toHaveLength(30);
        expect((secondBody.users as string).split(",")).toHaveLength(5);
    });

    it("empty id list is a no-op ok:true, no fetch call", async () => {
        const fetchMock = jest.fn();
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.inviteToChannel("C1", []);
        expect(result).toEqual({ ok: true });
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe("removeFromChannel (REVIEW ADDENDUM A2)", () => {
    it("not_in_channel is tolerated as alreadyInDesiredState", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: false, error: "not_in_channel" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.removeFromChannel("C1", "U1");
        expect(result).toEqual({ ok: true, alreadyInDesiredState: true });
    });

    it("success -> ok:true", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: true }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.removeFromChannel("C1", "U1");
        expect(result).toEqual({ ok: true });
    });

    it("429 -> ok:false with retryAfterMs", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(429, { ok: false }, { "retry-after": "2" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.removeFromChannel("C1", "U1");
        expect(result).toEqual({ ok: false, error: "ratelimited", retryAfterMs: 2000 });
    });

    it("a real error surfaces as ok:false", async () => {
        const fetchMock = jest.fn().mockResolvedValueOnce(jsonRes(200, { ok: false, error: "channel_not_found" }));
        const client = getSlackClient("xoxb-test", { fetchFn: fetchMock as unknown as typeof fetch });
        const result = await client!.removeFromChannel("C1", "U1");
        expect(result).toEqual({ ok: false, error: "channel_not_found" });
    });
});
