import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";
import { apiError } from "@/lib/api-response";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember', 'isKeyholder'] },
    async () => {
        try {
            const members = await prisma.person.findMany({
                where: { isBoardMember: true },
                select: { id: true, name: true, phone: true, email: true },
                orderBy: { name: "asc" },
            });
            return NextResponse.json({ members });
        } catch (error) {
            await logBackendError(error, "GET /api/safety/board-contacts");
            return apiError("Internal Server Error fetching board contacts.", 500);
        }
    }
);
