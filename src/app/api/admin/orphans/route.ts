import prisma from "@/lib/prisma";
import { handler } from "@/security/handler";

export const dynamic = 'force-dynamic';

export const GET = handler('GET /api/admin/orphans', async () => {
    const eighteenYearsAgo = new Date();
    eighteenYearsAgo.setFullYear(eighteenYearsAgo.getFullYear() - 18);

    const students = await prisma.participant.findMany({
        where: {
            dob: { gt: eighteenYearsAgo }
        },
        include: {
            household: {
                include: {
                    participants: true
                }
            }
        }
    });

    const orphans = students.filter(student => {
        if (!student.household) return true;

        const signedUpAdults = student.household.participants.filter(p => {
            const isAdult = !p.dob || new Date(p.dob) <= eighteenYearsAgo;
            return isAdult && p.googleId !== null;
        });

        return signedUpAdults.length === 0;
    });

    return { Participant: orphans };
});
