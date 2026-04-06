import crypto from 'crypto';

export function isAuthorizedCron(req: Request): boolean {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || !authHeader) {
        return false;
    }

    const expectedAuth = `Bearer ${cronSecret}`;
    const headerBuffer = Buffer.from(authHeader);
    const expectedBuffer = Buffer.from(expectedAuth);

    if (headerBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(headerBuffer, expectedBuffer)) {
        return false;
    }

    return true;
}
