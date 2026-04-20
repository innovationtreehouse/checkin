import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { logger } from "@/lib/logger";

/**
 * Expected to be called by an external CRON trigger
 * GET /api/cron/membership-reminders
 */
export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        // Find households pending background check
        const pendingHouseholds = await prisma.household.findMany({
            where: {
                membershipStatus: 'PENDING_BG_CHECK'
            },
            include: {
                backgroundCheckCertifications: true,
                leads: {
                    where: { isPrimary: true },
                    include: { participant: true }
                }
            }
        });

        if (pendingHouseholds.length === 0) {
            return NextResponse.json({ success: true, message: "No pending households." });
        }

        // Find board members
        const boardMembers = await prisma.participant.findMany({
            where: { boardMember: true, email: { not: null } }
        });

        if (boardMembers.length === 0) {
            logger.warn("No board members found to notify about pending memberships.");
            return NextResponse.json({ success: false, error: "No board members found" });
        }

        let emailsSent = 0;
        const emailPromises: Promise<void>[] = [];

        // Build summary message
        let summaryHtml = "<h3>Pending Membership Background Checks</h3>";
        summaryHtml += "<p>The following households are waiting for board certification:</p><ul>";
        
        for (const hh of pendingHouseholds) {
            const primaryLead = hh.leads[0]?.participant?.name || "Unknown";
            const currentCerts = hh.backgroundCheckCertifications.length;
            summaryHtml += `<li>Household #${hh.id} (${primaryLead}) - ${currentCerts}/2 Certifications Complete</li>`;
        }
        summaryHtml += "</ul><p>Please log in to the admin portal to review and certify these households.</p>";

        for (const boardMember of boardMembers) {
            if (boardMember.email) {
                const promise = sendEmail(
                    boardMember.email, 
                    "Action Required: Pending Membership Background Checks", 
                    summaryHtml
                ).then(() => { emailsSent++; }).catch(e => logger.error(`Failed to email board member ${boardMember.email}`, e));
                emailPromises.push(promise);
            }
        }

        await Promise.all(emailPromises);

        return NextResponse.json({ success: true, pendingCount: pendingHouseholds.length, emailsSent });
    } catch (error) {
        logger.error("Failed to run membership reminders cron:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
