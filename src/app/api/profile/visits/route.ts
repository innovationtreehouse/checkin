/* eslint-disable @typescript-eslint/no-explicit-any */
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";

export async function GET(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session || !session.user || !(session.user as any).id) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const userId = (session.user as any).id;
        const { searchParams } = new URL(req.url);
        const filterDateStr = searchParams.get('date');

        let startDate: Date;
        let endDate: Date;

        if (filterDateStr) {
            const baseDate = new Date(filterDateStr);
            startDate = new Date(baseDate);
            startDate.setDate(baseDate.getDate() - 7);
            endDate = new Date(baseDate);
            endDate.setDate(baseDate.getDate() + 7);
        } else {
            endDate = new Date();
            startDate = new Date();
            startDate.setDate(endDate.getDate() - 7);
        }

        const visits = await prisma.visit.findMany({
            where: {
                participantId: userId,
                arrived: {
                    gte: startDate,
                    lte: endDate
                }
            },
            orderBy: { arrived: 'desc' },
            select: {
                id: true,
                arrived: true,
                departed: true,
                event: { select: { name: true } }
            }
        });

        return NextResponse.json({ visits }, { status: 200 });
    } catch (error: any) {
        console.error("Profile Visits GET Error:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
