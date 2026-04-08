import crypto from "crypto";
import { logger } from "@/lib/logger";

/**
 * Validates the authorization header for cron endpoints against process.env.CRON_SECRET.
 * Uses SHA-256 hashing to prevent timing attacks and length leakage.
 *
 * @param req The incoming Request object
 * @returns boolean indicating if the request is authorized
 */
export function isAuthorizedCron(req: Request): boolean {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        logger.error("Cron secret is not configured in environment variables.");
        return false;
    }

    if (!authHeader) {
        return false;
    }

    const expectedHeader = `Bearer ${cronSecret}`;

    // Hash both headers before comparing to prevent length leakage
    // since timingSafeEqual fails fast if lengths don't match
    const providedHash = crypto.createHash('sha256').update(authHeader).digest();
    const expectedHash = crypto.createHash('sha256').update(expectedHeader).digest();

    return crypto.timingSafeEqual(providedHash, expectedHash);
}
