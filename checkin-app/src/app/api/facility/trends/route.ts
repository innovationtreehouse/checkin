import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { getAppSettings } from "@/lib/appSettings";

type PeriodType = "week" | "month" | "quarter" | "year";

function getHoursBetween(arrived: Date, departed: Date | null): number {
    if (!departed) return 0;
    return (departed.getTime() - arrived.getTime()) / (1000 * 60 * 60);
}

function getPeriodStart(date: Date, period: PeriodType): Date {
    const d = new Date(date);
    if (period === "week") {
        const day = d.getDay();
        d.setDate(d.getDate() - day);
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

function formatPeriodLabel(date: Date, period: PeriodType, locale: string): string {
    if (period === "week") {
        const end = new Date(date);
        end.setDate(end.getDate() + 6);
        return `${date.toLocaleDateString(locale, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`;
    } else if (period === "month") {
        return date.toLocaleDateString(locale, { month: "long", year: "numeric" });
    } else if (period === "quarter") {
        const q = Math.floor(date.getMonth() / 3) + 1;
        return `Q${q} ${date.getFullYear()}`;
    } else {
        return `${date.getFullYear()}`;
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
    { roles: ['isSysadmin', 'isBoardMember'] },
    async (req) => {
        try {
            const url = new URL(req.url);
            const period = (url.searchParams.get("period") || "month") as PeriodType;
            const programIdParam = url.searchParams.get("programId");
            const programId = programIdParam ? parseInt(programIdParam, 10) : null;

            if (!["week", "month", "quarter", "year"].includes(period)) {
                return NextResponse.json({ error: "Invalid period. Use week, month, quarter, or year." }, { status: 400 });
            }

            const { locale } = await getAppSettings();

            const lookbackMs = getLookbackMonths(period) * 30 * 24 * 60 * 60 * 1000;
            const since = new Date(Date.now() - lookbackMs);

            const whereClause: Record<string, unknown> = {
                arrivedAt: { gte: since },
                departedAt: { not: null },
                // Exclude synthetic "marked present" visits (events attendance route): their
                // arrivedAt/departedAt is the event window, not a measured duration. arrivedVia=SYSTEM
                // is the marker — real visits use SCANNER/WEB on arrival.
                arrivedVia: { not: "SYSTEM" },
            };

            if (programId) {
                whereClause.event = { programId };
            }

            const visits = await prisma.visit.findMany({
                where: whereClause,
                include: {
                    participant: { select: { id: true } },
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
                select: { participantId: true },
            });
            const enrolledParticipantIds = new Set(enrollments.map(e => e.participantId));

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
                const periodStart = getPeriodStart(visit.arrivedAt, period);
                const key = periodStart.toISOString();

                if (!bucketMap.has(key)) {
                    bucketMap.set(key, {
                        label: formatPeriodLabel(periodStart, period, locale),
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
                const isParticipant = enrolledParticipantIds.has(visit.participant.id);

                if (isParticipant) {
                    bucket.participantIds.add(visit.participant.id);
                    bucket.participantHours += hours;
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
                uniqueVolunteers: new Set(visits.filter(v => !enrolledParticipantIds.has(v.participant.id)).map(v => v.participant.id)).size,
                uniqueParticipants: new Set(visits.filter(v => enrolledParticipantIds.has(v.participant.id)).map(v => v.participant.id)).size,
                totalVolunteerHours: Math.round(buckets.reduce((s, b) => s + b.totalVolunteerHours, 0) * 10) / 10,
                totalParticipantHours: Math.round(buckets.reduce((s, b) => s + b.totalParticipantHours, 0) * 10) / 10,
                structuredHours: Math.round(buckets.reduce((s, b) => s + b.structuredHours, 0) * 10) / 10,
                unstructuredHours: Math.round(buckets.reduce((s, b) => s + b.unstructuredHours, 0) * 10) / 10,
            };

            return NextResponse.json({ buckets, totals, period });
        } catch (error) {
            console.error("Trends API error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
