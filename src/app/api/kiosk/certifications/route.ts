import prisma from "@/lib/prisma";
import { handler, unauthorized } from "@/security/handler";

export const GET = handler('GET /api/kiosk/certifications', async ({ req, auth }) => {
    if (auth.type !== 'session' && auth.type !== 'kiosk') throw unauthorized();

    const url = new URL(req.url);
    const limitToPresent = url.searchParams.get("limit_to_present") !== "false";

    let participantsData;

    if (limitToPresent) {
        const activeVisits = await prisma.visit.findMany({
            where: { departed: null },
            include: {
                participant: {
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        dob: true,
                        shopSteward: true,
                        toolStatuses: {
                            select: { toolId: true, level: true }
                        }
                    }
                }
            },
            orderBy: { arrived: "desc" }
        });
        participantsData = activeVisits.map(v => v.participant);
    } else {
        participantsData = await prisma.participant.findMany({
            select: {
                id: true,
                email: true,
                name: true,
                dob: true,
                shopSteward: true,
                toolStatuses: {
                    select: { toolId: true, level: true }
                }
            }
        });
    }

    const participantsWithAgeCategory = participantsData.map((participant) => {
        const dob = participant.dob;
        let ageCategory = "ADULT";

        if (dob) {
            const birthDate = new Date(dob);
            const today = new Date();
            let age = today.getFullYear() - birthDate.getFullYear();
            const m = today.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) age--;
            if (age < 18) {
                ageCategory = "STUDENT";
            }
        }

        return {
            id: participant.id,
            email: participant.email,
            name: participant.name,
            shopSteward: participant.shopSteward,
            toolStatuses: participant.toolStatuses,
            ageCategory,
        };
    });

    const tools = await prisma.tool.findMany({
        orderBy: {
            name: "asc"
        },
        select: {
            id: true,
            name: true
        }
    });

    return { participants: participantsWithAgeCategory, tools };
});
