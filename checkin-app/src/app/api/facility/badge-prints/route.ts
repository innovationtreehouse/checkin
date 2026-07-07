import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";
import { calendarYearWindow, isReportableYear } from "@/lib/badgePrints";

export const dynamic = "force-dynamic";

const ROLES = ["isSysadmin", "isBoardMember"] as const;
const MAX_PER_REQUEST = 500;

export interface PrintedEntry {
    personId: number;
    name: string | null;
    email: string | null;
    lastPrintedAt: string;
    printedBy: string | null;
    count: number;
}
export interface GapEntry {
    personId: number;
    name: string | null;
    email: string | null;
}

/**
 * GET /api/facility/badge-prints?year=YYYY — badge-print report for a calendar
 * year. Returns who was printed (grouped by person, most recent + count) and the
 * gap list (people who visited that year with no print). See
 * docs/designs/BADGE_PRINT_TRACKING.md.
 */
export const GET = withAuth({ roles: [...ROLES] }, async (req) => {
    try {
        const url = new URL(req.url);
        const parsed = parseInt(url.searchParams.get("year") ?? "", 10);
        const year = isReportableYear(parsed) ? parsed : new Date().getUTCFullYear();
        const { start, end } = calendarYearWindow(year);

        // Prints in the window, newest first — so the first row seen per person is
        // the most recent print.
        const prints = await prisma.badgePrint.findMany({
            where: { printedAt: { gte: start, lt: end } },
            orderBy: { printedAt: "desc" },
            include: {
                person: { select: { id: true, name: true, email: true } },
                printedBy: { select: { name: true } },
            },
        });

        const byPerson = new Map<number, PrintedEntry>();
        for (const p of prints) {
            const cur = byPerson.get(p.personId);
            if (cur) {
                cur.count += 1;
            } else {
                byPerson.set(p.personId, {
                    personId: p.personId,
                    name: p.person.name,
                    email: p.person.email,
                    lastPrintedAt: p.printedAt.toISOString(),
                    printedBy: p.printedBy?.name ?? null,
                    count: 1,
                });
            }
        }
        const printed = [...byPerson.values()];
        const printedIds = new Set(printed.map((p) => p.personId));

        // "Needs a badge this year" = anyone who checked in during the year. `visits`
        // is a where-only filter (no Visit rows returned), so this stays a plain
        // Person read — see the route auth drift-guard's edge rule.
        const population = await prisma.person.findMany({
            where: { visits: { some: { arrivedAt: { gte: start, lt: end } } } },
            select: { id: true, name: true, email: true },
            orderBy: { name: "asc" },
        });
        const gaps: GapEntry[] = population
            .filter((p) => !printedIds.has(p.id))
            .map((p) => ({ personId: p.id, name: p.name, email: p.email }));

        return NextResponse.json({ year, printed, gaps });
    } catch (error) {
        logger.error("Badge-print report error:", error);
        return apiError("Internal Server Error", 500);
    }
});

/**
 * POST /api/facility/badge-prints — mark one or more people's badges printed.
 * Body: { personIds: number[], note?: string }. A single-person mark is a
 * one-element array; the bulk mark is the same call with many ids. No dedup —
 * a repeat is a legitimate reprint and creates another row.
 */
export const POST = withAuth({ roles: [...ROLES] }, async (req, auth) => {
    if (auth.type !== "session") return apiError("Unauthorized", 401);

    let body: { personIds?: unknown; note?: unknown };
    try {
        body = await req.json();
    } catch {
        return apiError("Invalid JSON", 400);
    }

    const personIds = Array.isArray(body.personIds)
        ? [...new Set(body.personIds.filter((x): x is number => Number.isInteger(x)))]
        : [];
    if (personIds.length === 0) {
        return apiError("personIds must be a non-empty array of integers", 400);
    }
    if (personIds.length > MAX_PER_REQUEST) {
        return apiError(`Too many people in one request (max ${MAX_PER_REQUEST})`, 400);
    }
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 500) : null;

    try {
        const result = await prisma.badgePrint.createMany({
            data: personIds.map((personId) => ({ personId, printedById: auth.user.id, note })),
        });
        return NextResponse.json({ created: result.count });
    } catch (error) {
        // FK violation → an id doesn't resolve to a Person.
        if ((error as { code?: string }).code === "P2003") {
            return apiError("One or more people were not found", 400);
        }
        logger.error("Mark badge printed error:", error);
        return apiError("Internal Server Error", 500);
    }
});
