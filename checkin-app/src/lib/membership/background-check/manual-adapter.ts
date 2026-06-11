import { config } from "@/lib/config";
import type { BackgroundCheckProvider } from "./provider";

/**
 * Manual (human-marked) background-check provider for Averity/VERITY.
 *
 * Consent link comes from the AVERITY_CONSENT_URL env var (Averity exposes no API,
 * so it's a static hosted deep link, configured out-of-band rather than board-edited).
 * A board member receives Averity's email when an applicant submits consent and marks
 * it in our system.
 */
export class ManualBackgroundCheckProvider implements BackgroundCheckProvider {
    async getConsentDeepLink(): Promise<string | null> {
        return config.averityConsentUrl();
    }
}

/** The active provider. Swap here if a real-API provider is ever introduced. */
export const backgroundCheckProvider: BackgroundCheckProvider = new ManualBackgroundCheckProvider();
