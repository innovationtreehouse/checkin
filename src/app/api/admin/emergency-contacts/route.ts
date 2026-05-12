import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const GET = handler('GET /api/admin/emergency-contacts', async () => {
    const households = await prisma.household.findMany({
        include: {
            participants: {
                select: {
                    id: true,
                    name: true,
                    email: true,
                    visits: {
                        where: { departed: null },
                        select: { id: true }
                    }
                }
            },
            leads: {
                include: {
                    participant: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                            phone: true
                        }
                    }
                }
            }
        }
    });

    return { Household: households };
});
