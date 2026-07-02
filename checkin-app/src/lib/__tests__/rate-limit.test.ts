import { checkRateLimit, clientIpKey, rateLimit, rateLimitEmail } from "../rate-limit";
import { canonicalizeEmail } from "../emailNormalize";

describe("checkRateLimit", () => {
    it("allows up to the limit, blocks the N+1th, then resets after the window", () => {
        const key = "test:1.2.3.4";
        const limit = 5;
        const windowMs = 60_000;
        const start = 1_000_000;

        // First `limit` calls within the window are allowed.
        for (let i = 0; i < limit; i++) {
            expect(checkRateLimit(key, limit, windowMs, start).ok).toBe(true);
        }

        // The N+1th is blocked and reports a Retry-After in whole seconds.
        const blocked = checkRateLimit(key, limit, windowMs, start);
        expect(blocked.ok).toBe(false);
        expect(blocked.retryAfterSec).toBe(60);

        // Still blocked just before the window closes.
        expect(checkRateLimit(key, limit, windowMs, start + windowMs - 1).ok).toBe(false);

        // Window elapsed → counter resets, calls allowed again.
        expect(checkRateLimit(key, limit, windowMs, start + windowMs).ok).toBe(true);
    });

    it("keys independently — one IP's flood doesn't block another", () => {
        const limit = 2;
        const windowMs = 60_000;
        const now = 2_000_000;

        checkRateLimit("test:a", limit, windowMs, now);
        checkRateLimit("test:a", limit, windowMs, now);
        expect(checkRateLimit("test:a", limit, windowMs, now).ok).toBe(false);

        // Different key still has its full allowance.
        expect(checkRateLimit("test:b", limit, windowMs, now).ok).toBe(true);
    });
});

function reqWithIp(ip: string): Request {
    return new Request("https://x/", { headers: { "x-forwarded-for": ip } });
}

describe("clientIpKey", () => {
    it("collapses IPv6 addresses in the same /64 to one key, keeps different /64s apart", () => {
        const a = clientIpKey(reqWithIp("2001:db8:1:2:aaaa:bbbb:cccc:dddd"));
        const b = clientIpKey(reqWithIp("2001:db8:1:2:0:0:0:1"));
        const c = clientIpKey(reqWithIp("2001:db8:1:3:aaaa:bbbb:cccc:dddd"));

        expect(a).toBe(b); // same /64 prefix → same bucket
        expect(a).not.toBe(c); // different /64 → different bucket
    });

    it("handles :: compression when collapsing to /64", () => {
        // 2001:db8:: expands to 2001:db8:0:0:... — same /64 as the explicit form.
        expect(clientIpKey(reqWithIp("2001:db8::1"))).toBe(
            clientIpKey(reqWithIp("2001:db8:0:0:5:6:7:8")),
        );
    });

    it("keys IPv4 on the full address", () => {
        expect(clientIpKey(reqWithIp("1.2.3.4"))).toBe("1.2.3.4");
        expect(clientIpKey(reqWithIp("1.2.3.4"))).not.toBe(clientIpKey(reqWithIp("1.2.3.5")));
    });

    it("uses the leftmost x-forwarded-for hop", () => {
        expect(clientIpKey(reqWithIp("9.9.9.9, 10.0.0.1"))).toBe("9.9.9.9");
    });
});

describe("canonicalizeEmail", () => {
    it("strips plus-tags for any provider", () => {
        expect(canonicalizeEmail("victim+sale@outlook.com")).toBe("victim@outlook.com");
        expect(canonicalizeEmail("victim+a@gmail.com")).toBe(canonicalizeEmail("victim@gmail.com"));
    });

    it("drops Gmail dots and treats googlemail as gmail", () => {
        expect(canonicalizeEmail("Foo.Bar+sale@GoogleMail.com")).toBe("foobar@gmail.com");
        expect(canonicalizeEmail("v.i.c.t.i.m@gmail.com")).toBe(canonicalizeEmail("victim@gmail.com"));
    });

    it("keeps dots significant for non-Gmail domains", () => {
        expect(canonicalizeEmail("foo.bar@outlook.com")).not.toBe(canonicalizeEmail("foobar@outlook.com"));
    });
});

// The pure checkRateLimit is covered above; these exercise the NextResponse
// wrappers routes actually call — the 429 body + Retry-After header on overflow.
// Each case uses a unique route name so the shared bucket Map doesn't leak.
describe("rateLimit / rateLimitEmail wrappers", () => {
    it("rateLimit returns null under the limit, then a 429 with Retry-After", async () => {
        const req = reqWithIp("203.0.113.7");
        const opts = { name: "wrap-ip-test", limit: 2, windowMs: 60_000 };

        expect(rateLimit(req, opts)).toBeNull();
        expect(rateLimit(req, opts)).toBeNull();

        const res = rateLimit(req, opts)!;
        expect(res).not.toBeNull();
        expect(res.status).toBe(429);
        const retryAfter = Number(res.headers.get("Retry-After"));
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(60);
        expect((await res.json()).error).toMatch(/too many/i);
    });

    it("rateLimitEmail returns null under the limit, then a 429 with Retry-After", async () => {
        const email = "flood-victim@example.com";
        const opts = { name: "wrap-email-test", limit: 1, windowMs: 60_000 };

        expect(rateLimitEmail(email, opts)).toBeNull();

        const res = rateLimitEmail(email, opts)!;
        expect(res.status).toBe(429);
        expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
        expect((await res.json()).error).toMatch(/too many/i);
    });
});
