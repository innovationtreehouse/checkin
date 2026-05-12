import { handler } from "@/security/handler";

export const GET = handler('GET /api/health', async () => {
    return { status: "ok" };
});
