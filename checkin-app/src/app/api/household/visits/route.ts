import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

export const GET = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
            const userId = auth.user.id;

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

            const user = await prisma.person.findUnique({
                where: { id: userId },
                select: { householdId: true }
            });

            if (!user || !user.householdId) {
                return NextResponse.json({ visits: [] }, { status: 200 });
            }

            const visits = await prisma.visit.findMany({
                where: {
                    person: {
                        householdId: user.householdId
                    },
                    arrivedAt: {
                        gte: startDate,
                        lte: endDate
                    }
                },
                orderBy: { arrivedAt: 'desc' },
                include: {
                    person: { select: { id: true, name: true } },
                    event: { select: { id: true, name: true } }
                }
            });

            return NextResponse.json({ visits }, { status: 200 });
        } catch (error) {
            logger.error("Household Visits GET Error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
