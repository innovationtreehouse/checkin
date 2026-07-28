import { NextResponse, type NextRequest } from "next/server";
import { logger } from "@/lib/logger";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { apiError } from "@/lib/api-response";

// Mark an integration error resolved / unresolved.
export const PATCH = withAuth<{ params: Promise<{ id: string }> }>(
    { roles: ["isSysadmin", "isBoardMember"] },
    async (req: NextRequest, _auth, { params }) => {
        const { id } = await params;
        const errorId = parseInt(id, 10);
        if (isNaN(errorId)) {
            return apiError("Invalid id", 400);
        }

        try {
            const body = await req.json().catch(() => ({}));
            const resolved = body?.resolved !== false; // default: mark resolved

            const updated = await prisma.integrationErrorLog.update({
                where: { id: errorId },
                data: { resolvedAt: resolved ? new Date() : null },
            });

            // eslint-disable-next-line no-restricted-syntax -- not an error response: `error` is the updated IntegrationErrorLog record (200). ponytail: rename key to `data` when a client touch is in scope.
            return NextResponse.json({ error: updated });
        } catch (error) {
            logger.error("Failed to update integration error:", error);
            return apiError("Internal Server Error", 500);
        }
    }
);
