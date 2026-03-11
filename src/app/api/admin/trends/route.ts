/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getCurrentUser, requireAdmin } from "@/lib/auth";

type PeriodType = "week" | "month" | "quarter" | "year";

function isStudentAtDate(dob: Date | null, refDate: Date): boolean {
    if (!dob) return false;
    let age = refDate.getFullYear() - dob.getFullYear();
    const m = refDate.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && refDate.getDate() < dob.getDate())) age--;
    return age < 18;
}

function getHoursBetween(arrived: Date, departed: Date | null): number {
    if (!departed) return 0;
    return (departed.getTime() - arrived.getTime()) / (1000 * 60 * 60);
}

/**
 * Returns the start-of-period date for a given date and period type.
 */
function getPeriodStart(date: Date, period: PeriodType): Date {
    const d = new Date(date);
    if (period === "week") {
        const day = d.getDay();
        d.setDate(d.getDate() - day); // Sunday start
        d.setHours(0, 0, 0, 0);
    } else if (period === "month") {
        d.setDate(1);
        d.setHours(0, 0, 0, 0);
    } else if (period === "quarter") {
        const qMonth = Math.floor(d.getMonth() / 3) * 3;
        d.setMonth(qMonth, 1);
        d.setHours(0, 0, 0, 0);
    } else {
        d.setMonth(0, 1);
        d.setHours(0, 0, 0, 0);
    }
    return d;
}

function formatPeriodLabel(date: Date, period: PeriodType): string {
    if (period === "week") {
        const end = new Date(date);
        end.setDate(end.getDate() + 6);
        return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
    } else if (period === "month") {
        return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    } else if (period === "quarter") {
        const q = Math.floor(date.getMonth() / 3) + 1;
        return `Q${q} ${date.getFullYear()}`;
    } else {
        return `${date.getFullYear()}`;
    }
}

/**
 * How far back to look for each period type.
 */
function getLookbackMonths(period: PeriodType): number {
    switch (period) {
        case "week": return 3;      // ~12 weeks
        case "month": return 12;    // 12 months
        case "quarter": return 24;  // 8 quarters
        case "year": return 60;     // 5 years
    }
}

export interface TrendBucket {
    label: string;
    periodStart: string;
    uniqueVolunteers: number;
    uniqueStudents: number;
    totalVolunteerHours: number;
    totalStudentHours: number;
    structuredHours: number;
    unstructuredHours: number;
}

export async function GET(req: NextRequest) {
    try {
        const user = await getCurrentUser();
        requireAdmin(user);

        const url = new URL(req.url);
        const period = (url.searchParams.get("period") || "month") as PeriodType;
        const programIdParam = url.searchParams.get("programId");
        const programId = programIdParam ? parseInt(programIdParam, 10) : null;

        if (!["week", "month", "quarter", "year"].includes(period)) {
            return NextResponse.json({ error: "Invalid period. Use week, month, quarter, or year." }, { status: 400 });
        }

        const lookbackMs = getLookbackMonths(period) * 30 * 24 * 60 * 60 * 1000;
        const since = new Date(Date.now() - lookbackMs);

        // Build visit query
        const whereClause: any = {
            arrived: { gte: since },
            departed: { not: null }, // only completed visits for hours
        };

        // If filtering by program, only include visits with an event belonging to that program
        if (programId) {
            whereClause.event = { programId };
        }

        const visits = await prisma.visit.findMany({
            where: whereClause,
            include: {
                participant: { select: { id: true, dob: true } },
                event: { select: { programId: true } },
            },
            orderBy: { arrived: "asc" },
        });

        // Bucket visits by period
        const bucketMap = new Map<string, {
            label: string;
            periodStart: Date;
            volunteerIds: Set<number>;
            studentIds: Set<number>;
            volunteerHours: number;
            studentHours: number;
            structuredHours: number;
            unstructuredHours: number;
        }>();

        for (const visit of visits) {
            const periodStart = getPeriodStart(visit.arrived, period);
            const key = periodStart.toISOString();

            if (!bucketMap.has(key)) {
                bucketMap.set(key, {
                    label: formatPeriodLabel(periodStart, period),
                    periodStart,
                    volunteerIds: new Set(),
                    studentIds: new Set(),
                    volunteerHours: 0,
                    studentHours: 0,
                    structuredHours: 0,
                    unstructuredHours: 0,
                });
            }

            const bucket = bucketMap.get(key)!;
            const hours = getHoursBetween(visit.arrived, visit.departed);
            const student = isStudentAtDate(visit.participant.dob, visit.arrived);

            if (student) {
                bucket.studentIds.add(visit.participant.id);
                bucket.studentHours += hours;
            } else {
                bucket.volunteerIds.add(visit.participant.id);
                bucket.volunteerHours += hours;
            }

            if (visit.associatedEventId != null) {
                bucket.structuredHours += hours;
            } else {
                bucket.unstructuredHours += hours;
            }
        }

        // Convert to output
        const buckets: TrendBucket[] = Array.from(bucketMap.values())
            .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
            .map(b => ({
                label: b.label,
                periodStart: b.periodStart.toISOString(),
                uniqueVolunteers: b.volunteerIds.size,
                uniqueStudents: b.studentIds.size,
                totalVolunteerHours: Math.round(b.volunteerHours * 10) / 10,
                totalStudentHours: Math.round(b.studentHours * 10) / 10,
                structuredHours: Math.round(b.structuredHours * 10) / 10,
                unstructuredHours: Math.round(b.unstructuredHours * 10) / 10,
            }));

        // Compute totals
        const totals: TrendBucket = {
            label: "Total",
            periodStart: "",
            uniqueVolunteers: new Set(visits.filter(v => !isStudentAtDate(v.participant.dob, v.arrived)).map(v => v.participant.id)).size,
            uniqueStudents: new Set(visits.filter(v => isStudentAtDate(v.participant.dob, v.arrived)).map(v => v.participant.id)).size,
            totalVolunteerHours: Math.round(buckets.reduce((s, b) => s + b.totalVolunteerHours, 0) * 10) / 10,
            totalStudentHours: Math.round(buckets.reduce((s, b) => s + b.totalStudentHours, 0) * 10) / 10,
            structuredHours: Math.round(buckets.reduce((s, b) => s + b.structuredHours, 0) * 10) / 10,
            unstructuredHours: Math.round(buckets.reduce((s, b) => s + b.unstructuredHours, 0) * 10) / 10,
        };

        return NextResponse.json({ buckets, totals, period });
    } catch (err: any) {
        if (err.message?.includes("Unauthorized")) {
            return NextResponse.json({ error: err.message }, { status: 403 });
        }
        console.error("Trends API error:", err);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
