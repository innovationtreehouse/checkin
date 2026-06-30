import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * Board-facing membership email alerts. Kept dependency-free (prisma + email +
 * logger only) so both the review path (review.ts) and the payment path
 * (payment.ts) can fire them without an import cycle.
 */

/**
 * Email board members that a household which ALREADY PAID did not pass
 * background-check review, so a refund can be arranged out-of-band. Fires in
 * BOTH orderings — a reject after the payment landed (review.ts) and a payment
 * webhook that lands after the reject (payment.ts). (We never move money
 * automatically.)
 */
export async function notifyBoardPaidReject(processId: number): Promise<void> {
    try {
        const board = await prisma.participant.findMany({
            where: { isBoardMember: true, email: { not: null } },
            select: { email: true },
        });
        const base = process.env.NEXTAUTH_URL ?? "";
        await Promise.all(
            board.map((b) =>
                b.email
                    ? sendEmail(
                          b.email,
                          "Membership: a paid application was blocked at background check",
                          `<p>A household that already paid did not pass background-check review (application #${processId}). The membership has <strong>not</strong> been activated and a refund may be needed — please review and contact the household. <a href="${base}/membership-ops/applications">Open applications</a></p>`,
                      ).catch((e) => logger.error("Paid-reject board ping failed:", e))
                    : Promise.resolve(),
            ),
        );
    } catch (e) {
        logger.error("notifyBoardPaidReject failed:", e);
    }
}
