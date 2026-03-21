/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth-options";
import prisma from "@/lib/prisma";

export async function GET() {
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user as any;
    if (!user.sysadmin && !user.keyholder && !user.boardMember) {
        return NextResponse.json({ error: "Forbidden. Only Keyholders, Board Members, or Admins can access." }, { status: 403 });
    }

    try {
        const boardMembers = await prisma.participant.findMany({
            where: { boardMember: true },
            select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                boardMember: true,
                shopSteward: true,
                sysadmin: true
            },
            orderBy: { name: 'asc' }
        });

        return NextResponse.json({ boardMembers });
    } catch (error) {
        console.error("Failed to fetch board directory:", error);
        return NextResponse.json({ error: "Failed to fetch board directory" }, { status: 500 });
    }
}
