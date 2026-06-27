import { withAuroraResumeRetry } from "@/lib/auroraResumeRetry";

const p1001 = Object.assign(new Error("Can't reach database server"), { code: "P1001" });

describe("withAuroraResumeRetry", () => {
    it("retries on P1001 then succeeds", async () => {
        let calls = 0;
        const result = await withAuroraResumeRetry(async () => {
            calls++;
            if (calls < 3) throw p1001;
            return "ok";
        }, 5, 0);
        expect(result).toBe("ok");
        expect(calls).toBe(3);
    });

    it("rethrows non-P1001 errors immediately", async () => {
        let calls = 0;
        await expect(
            withAuroraResumeRetry(async () => {
                calls++;
                throw new Error("boom");
            }, 5, 0),
        ).rejects.toThrow("boom");
        expect(calls).toBe(1);
    });

    it("gives up after the attempt cap on persistent P1001", async () => {
        let calls = 0;
        await expect(
            withAuroraResumeRetry(async () => {
                calls++;
                throw p1001;
            }, 3, 0),
        ).rejects.toMatchObject({ code: "P1001" });
        expect(calls).toBe(3);
    });
});
