import { execSync } from "child_process";
import { handler } from "@/security/handler";

let cachedVersion: string | null = null;

export const dynamic = "force-dynamic";

export const GET = handler('GET /api/kiosk/version', async () => {
    if (!cachedVersion) {
        try {
            if (process.env.VERCEL_GIT_COMMIT_SHA) {
                cachedVersion = process.env.VERCEL_GIT_COMMIT_SHA;
            } else {
                cachedVersion = execSync("git rev-parse HEAD").toString().trim();
            }
        } catch {
            cachedVersion = "unknown-" + Date.now();
        }
    }

    return { version: cachedVersion };
});
