import { getConfigHealth, openConfigIssues, type ConfigCheck } from "@/lib/configHealth";

// config.ts reads process.env live through getters, so these tests just set/clear
// env vars — no module mocking needed. NODE_ENV is "test" under jest, so the Zoho
// mock's NODE_ENV !== "production" fuse is always satisfied; CHECKIN_ENV drives prod.

const ZOHO_KEYS = ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN"];
const ALL_KEYS = [...ZOHO_KEYS, "ZOHO_WEBHOOK_SECRET", "AGREEMENT_PDF_S3_BUCKET", "RESEND_API_KEY", "GOOGLE_SA_KEY_JSON", "GOOGLE_SA_SUBJECT", "CHECKIN_ENV"];

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
    for (const k of ALL_KEYS) {
        saved[k] = process.env[k];
        delete process.env[k];
    }
});
afterEach(() => {
    for (const k of ALL_KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
    }
});

const byId = (checks: ConfigCheck[]) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe("getConfigHealth — prod, nothing configured", () => {
    it("every check fails and names its env var", () => {
        process.env.CHECKIN_ENV = "prod";
        const checks = getConfigHealth();
        const c = byId(checks);
        expect(c["zoho-esign"].ok).toBe(false);
        expect(c["zoho-esign"].detail).toContain("ZOHO_CLIENT_ID");
        expect(c["agreement-pdf-s3"].ok).toBe(false);
        expect(c["agreement-pdf-s3"].detail).toContain("AGREEMENT_PDF_S3_BUCKET");
        expect(c["zoho-webhook-secret"].ok).toBe(false);
        expect(c["zoho-webhook-secret"].detail).toContain("ZOHO_WEBHOOK_SECRET");
        expect(c["resend-email"].ok).toBe(false);
        expect(c["resend-email"].detail).toContain("RESEND_API_KEY");
        expect(c["google-groups"].ok).toBe(false);
        expect(c["google-groups"].detail).toContain("GOOGLE_SA_KEY_JSON");
        expect(openConfigIssues(checks)).toBe(5);
    });
});

describe("getConfigHealth — prod, all configured", () => {
    it("no open issues", () => {
        process.env.CHECKIN_ENV = "prod";
        process.env.ZOHO_CLIENT_ID = "id";
        process.env.ZOHO_CLIENT_SECRET = "secret";
        process.env.ZOHO_REFRESH_TOKEN = "refresh";
        process.env.ZOHO_WEBHOOK_SECRET = "whsecret";
        process.env.AGREEMENT_PDF_S3_BUCKET = "bucket";
        process.env.RESEND_API_KEY = "re_key";
        process.env.GOOGLE_SA_KEY_JSON = "{}";
        process.env.GOOGLE_SA_SUBJECT = "admin@innovationtreehouse.org";
        expect(openConfigIssues(getConfigHealth())).toBe(0);
    });
});

describe("getConfigHealth — dev/local, nothing configured", () => {
    it("mock/dev states keep every check green", () => {
        process.env.CHECKIN_ENV = "local";
        const checks = getConfigHealth();
        // Zoho + S3 ok via the active mock; webhook ok via mock-secret fallback;
        // Resend ok because email is optional outside prod.
        expect(openConfigIssues(checks)).toBe(0);
    });
});
