import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

export const GET = withAuth(
    {},
    async (req, auth) => {
        try {
            if (auth.type !== 'session') return apiError("Unauthorized", 401);
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

            const visits = await prisma.visit.findMany({
                where: {
                    personId: userId,
                    arrivedAt: {
                        gte: startDate,
                        lte: endDate
                    }
                },
                orderBy: { arrivedAt: 'desc' },
                select: {
                    id: true,
                    arrivedAt: true,
                    departedAt: true,
                    event: { select: { name: true } }
                }
            });

            return NextResponse.json({ visits }, { status: 200 });
        } catch (error) {
            logger.error("Profile Visits GET Error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);
