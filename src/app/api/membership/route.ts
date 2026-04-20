import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        
        let householdId = body.householdId;

        // If no householdId, we're creating a new one
        if (!householdId) {
            const { leads, children, emergencyContactName, emergencyContactPhone, healthInsuranceInfo } = body;
            const household = await prisma.household.create({
                data: {
                    membershipStatus: 'PENDING_PAYMENT',
                    healthInsuranceInfo,
                    emergencyContactName,
                    emergencyContactPhone,
                }
            });
            householdId = household.id;

            // Create leads & children...
            for (const lead of leads || []) {
                const participant = await prisma.participant.create({
                    data: { name: lead.name, email: lead.email, phone: lead.phone, householdId }
                });
                await prisma.householdLead.create({
                    data: { householdId, participantId: participant.id, isPrimary: lead.isPrimary || false }
                });
            }
            if (children) {
                for (const child of children) {
                    const dob = new Date();
                    if (child.age) {
                        dob.setFullYear(dob.getFullYear() - parseInt(child.age, 10));
                    }
                    await prisma.participant.create({ data: { name: child.name, dob, householdId } });
                }
            }
        } else {
            // Convert existing household -> update health insurance & confirm Primary Lead
            const { healthInsuranceInfo, primaryLeadParticipantId } = body;
            
            await prisma.household.update({
                where: { id: parseInt(householdId, 10) },
                data: { 
                    membershipStatus: 'PENDING_PAYMENT',
                    healthInsuranceInfo
                }
            });

            if (primaryLeadParticipantId) {
                // Reset all leads for this household to not primary
                await prisma.householdLead.updateMany({
                    where: { householdId: parseInt(householdId, 10) },
                    data: { isPrimary: false }
                });
                // Set the designated one to primary
                await prisma.householdLead.update({
                    where: { 
                        householdId_participantId: {
                            householdId: parseInt(householdId, 10),
                            participantId: parseInt(primaryLeadParticipantId, 10)
                        }
                    },
                    data: { isPrimary: true }
                });
            }
        }

        return NextResponse.json({ success: true, householdId });

    } catch (error) {
        console.error("Error joining membership:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
