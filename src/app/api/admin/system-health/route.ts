import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import prisma from "@/lib/prisma";

export async function GET() {
    try {
        const session = await getServerSession(authOptions);
         
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const user: any = session?.user;

        // Ensure only admins can access this
        if (!user || !(user.sysadmin || user.boardMember || user.keyholder)) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        // Get the date 30 days ago
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        // Fetch metrics for the last 30 days
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        const metrics = await prisma.systemMetric.findMany({
            where: {
                metric: "scan_response_time",
                timestamp: {
                    gte: thirtyDaysAgo,
                },
            },
            select: {
                value: true,
                timestamp: true,
            },
            orderBy: {
                timestamp: "asc",
            },
        });

        // Group by day (YYYY-MM-DD string)
        const groupedByDay: Record<string, number[]> = {};
        
        // Initialize the last 30 days with empty arrays
        const today = new Date();
        for (let i = 29; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            groupedByDay[dateStr] = [];
        }

        metrics.forEach((m: { timestamp: Date; value: number }) => {
            const dateStr = m.timestamp.toISOString().split('T')[0];
            if (groupedByDay[dateStr]) {
                groupedByDay[dateStr].push(m.value);
            }
        });

        const getPercentile = (data: number[], p: number) => {
            if (data.length === 0) return 0;
            // Sort to calculate percentiles correctly
            data.sort((a, b) => a - b);
            const index = (p / 100) * (data.length - 1);
            if (Math.floor(index) === index) {
                return data[index];
            }
            const i = Math.floor(index);
            const fraction = index - i;
            return data[i] + (data[i + 1] - data[i]) * fraction;
        };

        const dailyStats = Object.keys(groupedByDay).map(date => {
            const values = groupedByDay[date];
            return {
                date,
                count: values.length,
                median: Math.round(getPercentile(values, 50)),
                p90: Math.round(getPercentile(values, 90)),
                p99: Math.round(getPercentile(values, 99)),
            };
        });
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        prisma.systemMetric
            .deleteMany({
                where: {
                    timestamp: {
                        lt: thirtyDaysAgo,
                    },
                },
            })
            .catch((err: unknown) => console.error("Failed to delete old system metrics:", err));

        return NextResponse.json({
            days: dailyStats
        });
    } catch (error) {
        console.error("Failed to fetch system health metrics:", error);
        return NextResponse.json({ error: "Internal Server Error", details: String(error) }, { status: 500 });
    }
}
