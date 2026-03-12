import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const dynamic = 'force-dynamic';

export const GET = withAuth(
    { roles: ['sysadmin', 'boardMember'] },
    async () => {
        try {
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

            return NextResponse.json({ orphans: orphans.map(o => ({ id: o.id, name: o.name, email: o.email })) });
        } catch (error) {
            console.error("Failed to fetch orphaned students:", error);
            return NextResponse.json({ error: "Failed to fetch orphaned students" }, { status: 500 });
        }
    }
);
