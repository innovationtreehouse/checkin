import { checkRateLimit, clientIpKey, normalizeEmail } from "../rate-limit";

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

describe("normalizeEmail", () => {
    it("strips plus-tags for any provider", () => {
        expect(normalizeEmail("victim+sale@outlook.com")).toBe("victim@outlook.com");
        expect(normalizeEmail("victim+a@gmail.com")).toBe(normalizeEmail("victim@gmail.com"));
    });

    it("drops Gmail dots and treats googlemail as gmail", () => {
        expect(normalizeEmail("Foo.Bar+sale@GoogleMail.com")).toBe("foobar@gmail.com");
        expect(normalizeEmail("v.i.c.t.i.m@gmail.com")).toBe(normalizeEmail("victim@gmail.com"));
    });

    it("keeps dots significant for non-Gmail domains", () => {
        expect(normalizeEmail("foo.bar@outlook.com")).not.toBe(normalizeEmail("foobar@outlook.com"));
    });
});
