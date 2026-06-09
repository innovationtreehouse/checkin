import prisma from "@/lib/prisma";
import type { BackgroundCheckProvider } from "./provider";

/**
 * Manual (human-marked) background-check provider for Averity/VERITY.
 *
 * Consent link comes from BoardSettings.averityDeepLinkUrl (set on the board
 * settings page). There is no API: a board member receives Averity's email when
 * an applicant submits consent and marks it in our system.
 */
export class ManualBackgroundCheckProvider implements BackgroundCheckProvider {
    async getConsentDeepLink(): Promise<string | null> {
        const settings = await prisma.boardSettings.findUnique({ where: { id: 1 } });
        return settings?.averityDeepLinkUrl ?? null;
    }
}

/** The active provider. Swap here if a real-API provider is ever introduced. */
export const backgroundCheckProvider: BackgroundCheckProvider = new ManualBackgroundCheckProvider();
