import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { getAppSettings } from "@/lib/appSettings";
import { apiError } from "@/lib/api-response";
import { toZonedTime } from "date-fns-tz";
import { getPeriodStart, type PeriodType } from "@/lib/timePeriods";

function getHoursBetween(arrived: Date, departed: Date | null): number {
    if (!departed) return 0;
    return (departed.getTime() - arrived.getTime()) / (1000 * 60 * 60);
}

function formatPeriodLabel(date: Date, period: PeriodType, locale: string, timeZone: string): string {
    const d = toZonedTime(date, timeZone);
    if (period === "week") {
        const end = new Date(d);
        end.setDate(end.getDate() + 6);
        return `${d.toLocaleDateString(locale, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`;
    } else if (period === "month") {
        return d.toLocaleDateString(locale, { month: "long", year: "numeric" });
    } else if (period === "quarter") {
        const q = Math.floor(d.getMonth() / 3) + 1;
        return `Q${q} ${d.getFullYear()}`;
    } else {
        return `${d.getFullYear()}`;
    }
}

function getLookbackMonths(period: PeriodType): number {
    switch (period) {
        case "week": return 3;
        case "month": return 12;
        case "quarter": return 24;
        case "year": return 60;
    }
}

export interface TrendBucket {
    label: string;
    periodStart: string;
    uniqueVolunteers: number;
    uniqueParticipants: number;
    totalVolunteerHours: number;
    totalParticipantHours: number;
    structuredHours: number;
    unstructuredHours: number;
}

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember', 'isOperations'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const period = (url.searchParams.get("period") || "month") as PeriodType;
            const programIdParam = url.searchParams.get("programId");
            const programId = programIdParam ? parseInt(programIdParam, 10) : null;

            if (!["week", "month", "quarter", "year"].includes(period)) {
                return apiError("Invalid period. Use week, month, quarter, or year.", 400);
            }

            const { locale, timezone } = await getAppSettings();

            const lookbackMs = getLookbackMonths(period) * 30 * 24 * 60 * 60 * 1000;
            const since = new Date(Date.now() - lookbackMs);

            const whereClause: Record<string, unknown> = {
                arrivedAt: { gte: since },
                departedAt: { not: null },
                deletedAt: null,
                // Drop staff-asserted arrivals (LEAD_MARKED, and its legacy spelling
                // SYSTEM): those times are an event window, not a measured duration.
                // The events roster mark stamps LEAD_MARKED on the visits it creates;
                // a walk-in it adopts keeps its measured SCANNER/WEB and still counts.
                // An untagged (null) arrival is an ordinary visit and counts — it needs
                // the explicit OR, because NULL never satisfies a SQL NOT IN.
                OR: [
                    { arrivedVia: null },
                    { arrivedVia: { notIn: ["LEAD_MARKED", "SYSTEM"] } },
                ],
            };

            if (programId) {
                whereClause.event = { programId };
            }

            const visits = await prisma.visit.findMany({
                where: whereClause,
                include: {
                    person: { select: { id: true } },
                    event: { select: { programId: true } },
                },
                orderBy: { arrivedAt: "asc" },
            });

            // "Participant hours" = hours logged by people ENROLLED in a program
            // (ProgramParticipant), not an age proxy. Per-program view counts enrollment in
            // that program; aggregate view counts enrollment in any program. Only ACTIVE
            // enrollments count — PENDING is applied-but-not-yet-approved, not an enrollee.
            const enrollments = await prisma.programParticipant.findMany({
                where: { status: "ACTIVE", ...(programId ? { programId } : {}) },
                select: { personId: true },
            });
            const enrolledParticipantIds = new Set(enrollments.map(e => e.personId));

            const bucketMap = new Map<string, {
                label: string;
                periodStart: Date;
                volunteerIds: Set<number>;
                participantIds: Set<number>;
                volunteerHours: number;
                participantHours: number;
                structuredHours: number;
                unstructuredHours: number;
            }>();

            for (const visit of visits) {
                const periodStart = getPeriodStart(visit.arrivedAt, period, timezone);
                const key = periodStart.toISOString();

                if (!bucketMap.has(key)) {
                    bucketMap.set(key, {
                        label: formatPeriodLabel(periodStart, period, locale, timezone),
                        periodStart,
                        volunteerIds: new Set(),
                        participantIds: new Set(),
                        volunteerHours: 0,
                        participantHours: 0,
                        structuredHours: 0,
                        unstructuredHours: 0,
                    });
                }

                const bucket = bucketMap.get(key)!;
                const hours = getHoursBetween(visit.arrivedAt, visit.departedAt);
                const isParticipant = enrolledParticipantIds.has(visit.person.id);

                if (isParticipant) {
                    bucket.participantIds.add(visit.person.id);
                    bucket.participantHours += hours;
                } else {
                    bucket.volunteerIds.add(visit.person.id);
                    bucket.volunteerHours += hours;
                }

                if (visit.associatedEventId != null) {
                    bucket.structuredHours += hours;
                } else {
                    bucket.unstructuredHours += hours;
                }
            }

            const buckets: TrendBucket[] = Array.from(bucketMap.values())
                .sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime())
                .map(b => ({
                    label: b.label,
                    periodStart: b.periodStart.toISOString(),
                    uniqueVolunteers: b.volunteerIds.size,
                    uniqueParticipants: b.participantIds.size,
                    totalVolunteerHours: Math.round(b.volunteerHours * 10) / 10,
                    totalParticipantHours: Math.round(b.participantHours * 10) / 10,
                    structuredHours: Math.round(b.structuredHours * 10) / 10,
                    unstructuredHours: Math.round(b.unstructuredHours * 10) / 10,
                }));

            const totals: TrendBucket = {
                label: "Total",
                periodStart: "",
                uniqueVolunteers: new Set(visits.filter(v => !enrolledParticipantIds.has(v.person.id)).map(v => v.person.id)).size,
                uniqueParticipants: new Set(visits.filter(v => enrolledParticipantIds.has(v.person.id)).map(v => v.person.id)).size,
                totalVolunteerHours: Math.round(buckets.reduce((s, b) => s + b.totalVolunteerHours, 0) * 10) / 10,
                totalParticipantHours: Math.round(buckets.reduce((s, b) => s + b.totalParticipantHours, 0) * 10) / 10,
                structuredHours: Math.round(buckets.reduce((s, b) => s + b.structuredHours, 0) * 10) / 10,
                unstructuredHours: Math.round(buckets.reduce((s, b) => s + b.unstructuredHours, 0) * 10) / 10,
            };

            return NextResponse.json({ buckets, totals, period });
        } catch (error) {
            logger.error("Trends API error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);
