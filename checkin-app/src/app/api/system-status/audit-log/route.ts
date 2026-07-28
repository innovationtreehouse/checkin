// Sysadmin telemetry viewer: returns a page of AuditLog rows for forensic
// review, newest first. Backs the "Audit Log" tab on /system-status.
// Server-side paged + filtered so the full history is reachable without ever
// shipping it all at once.
import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import type { Prisma } from "@/generated/prisma/client";
import { apiError } from "@/lib/api-response";

const PAGE_SIZE = 50;
const ACTIONS = ["CREATE", "EDIT", "DELETE", "BECOME_ADMIN"] as const;

export const GET = withAuth(
    { roles: ['isSysadmin'] },
    async (req: NextRequest) => {
        try {
            const sp = new URL(req.url).searchParams;

            const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10) || 1);

            const where: Prisma.AuditLogWhereInput = {};

            const action = sp.get("action");
            if (action && (ACTIONS as readonly string[]).includes(action)) {
                where.action = action as Prisma.AuditLogWhereInput["action"];
            }

            const table = sp.get("table");
            if (table) where.tableName = table;

            // from/to are yyyy-mm-dd. Inclusive day range, parsed in server TZ.
            // ponytail: server-local day boundaries; revisit if multi-TZ forensics matter.
            const from = sp.get("from");
            const to = sp.get("to");
            if (from || to) {
                where.timestamp = {};
                if (from) where.timestamp.gte = new Date(`${from}T00:00:00.000`);
                if (to) where.timestamp.lte = new Date(`${to}T23:59:59.999`);
            }

            const [total, rows, tableRows] = await Promise.all([
                prisma.auditLog.count({ where }),
                prisma.auditLog.findMany({
                    where,
                    orderBy: { timestamp: 'desc' },
                    skip: (page - 1) * PAGE_SIZE,
                    take: PAGE_SIZE,
                }),
                // Distinct entity types for the filter dropdown (unfiltered, stable).
                prisma.auditLog.findMany({
                    distinct: ['tableName'],
                    select: { tableName: true },
                    orderBy: { tableName: 'asc' },
                }),
            ]);

            // Resolve actor ids to names (one batched lookup). id 0 / missing => System.
            const actorIds = [...new Set(rows.map((r) => r.actorId))];
            const actors = await prisma.person.findMany({
                where: { id: { in: actorIds } },
                select: { id: true, name: true },
            });
            const nameById = new Map(actors.map((a) => [a.id, a.name]));

            const logs = rows.map((r) => ({
                ...r,
                actorName: nameById.get(r.actorId) ?? null,
            }));

            return NextResponse.json({
                logs,
                total,
                page,
                pageSize: PAGE_SIZE,
                tables: tableRows.map((t) => t.tableName),
            });
        } catch (error) {
            logger.error("Failed to fetch audit logs:", error);
            return apiError("Failed to fetch audit logs", 500);
        }
    }
);
