import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { sendEmail } from "@/lib/email";

export const POST = withAuth(
    { roles: ["boardMember", "sysadmin"] },
    async (req, auth) => {
        if (auth.type !== 'session') {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        
        try {
            const body = await req.json();
            const householdId = parseInt(body.householdId, 10);
            
            if (isNaN(householdId)) {
                return NextResponse.json({ error: "Invalid household ID" }, { status: 400 });
            }

            const household = await prisma.household.findUnique({
                where: { id: householdId },
                include: { 
                    backgroundCheckCertifications: true,
                    leads: { include: { participant: true } }
                }
            });

            if (!household) {
                return NextResponse.json({ error: "Household not found" }, { status: 404 });
            }

            if (household.membershipStatus !== 'PENDING_BG_CHECK') {
                return NextResponse.json({ error: "Household is not pending background check" }, { status: 400 });
            }

            // Check if this board member already certified
            const boardMemberId = auth.user.id;
            const alreadyCertified = household.backgroundCheckCertifications.some(c => c.certifiedById === boardMemberId);
            
            if (alreadyCertified) {
                return NextResponse.json({ error: "You have already certified this background check" }, { status: 400 });
            }

            // Create certification
            await prisma.backgroundCheckCertification.create({
                data: {
                    householdId,
                    certifiedById: boardMemberId
                }
            });

            // Check if we hit 2 certifications
            const totalCerts = household.backgroundCheckCertifications.length + 1;
            
            if (totalCerts >= 2) {
                // Advance status
                await prisma.household.update({
                    where: { id: householdId },
                    data: { membershipStatus: 'APPROVED' }
                });
                
                // Create or update Membership record
                const existingMembership = await prisma.membership.findFirst({
                    where: { householdId }
                });

                if (existingMembership) {
                    await prisma.membership.update({
                        where: { id: existingMembership.id },
                        data: { active: true, type: 'HOUSEHOLD' }
                    });
                } else {
                    await prisma.membership.create({
                        data: { householdId, type: 'HOUSEHOLD', active: true }
                    });
                }
                
                logger.info(`[MEMBERSHIP] Household ${householdId} approved via background check certification.`);
                
                // Fetch primary lead's email
                const primaryLead = household.leads.find(l => l.isPrimary)?.participant || household.leads[0]?.participant;
                if (primaryLead?.email) {
                    const welcomeHtml = `
                        <h2>Welcome to the Treehouse! 🎉</h2>
                        <p>Hi ${primaryLead.name},</p>
                        <p>Congratulations! Your background check has been certified by the board, and you are officially a Member of the Innovation Treehouse.</p>
                        <p>We are thrilled to have your household join our community. Your membership is now active, and you can access member-only programs and resources.</p>
                        <p>See you at the Treehouse!</p>
                    `;
                    await sendEmail(primaryLead.email, "Welcome to the Treehouse!", welcomeHtml);
                }
            }

            return NextResponse.json({ success: true, status: totalCerts >= 2 ? 'APPROVED' : 'PENDING_BG_CHECK' });
        } catch (error) {
            logger.error("Error certifying membership:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
