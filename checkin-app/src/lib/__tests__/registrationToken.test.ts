import { encodeRegistrationToken, decodeRegistrationToken } from "../registrationToken";

// key() reads NEXTAUTH_SECRET; set a deterministic one for the test.
process.env.NEXTAUTH_SECRET = "test-secret-for-registration-tokens";

describe("registrationToken", () => {
    const payload = { programId: 7, parents: [{ name: "Dad", email: "d@x.com" }] };

    it("round-trips a payload within the window", () => {
        const now = 1_000_000;
        const token = encodeRegistrationToken(payload, now);
        const decoded = decodeRegistrationToken<typeof payload & { exp: number }>(token, now + 1000);
        expect(decoded).toMatchObject(payload);
    });

    it("returns null once expired", () => {
        const now = 1_000_000;
        const token = encodeRegistrationToken(payload, now);
        // TTL is 24h; jump past it.
        expect(decodeRegistrationToken(token, now + 25 * 60 * 60 * 1000)).toBeNull();
    });

    it("returns null when the ciphertext is tampered", () => {
        const now = 1_000_000;
        const token = encodeRegistrationToken(payload, now);
        // Flip a character in the middle (still valid base64url, bad auth tag).
        const i = Math.floor(token.length / 2);
        const swap = token[i] === "A" ? "B" : "A";
        const tampered = token.slice(0, i) + swap + token.slice(i + 1);
        expect(decodeRegistrationToken(tampered, now)).toBeNull();
    });

    it("returns null for garbage input", () => {
        expect(decodeRegistrationToken("not-a-real-token", 0)).toBeNull();
    });
});
