/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "../../auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const session = await getServerSession(authOptions);

    if (!session || (!(session.user as any)?.sysadmin && !(session.user as any)?.boardMember)) {
        return NextResponse.json({ error: "Forbidden: Admin access required" }, { status: 403 });
    }

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

            // Look for any signed-up adult in the same household
            // "Signed up" is inferred by having a googleId (logged in at least once)
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
