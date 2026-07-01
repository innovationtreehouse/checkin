import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";
import { logBackendError } from "@/lib/logger";

export const GET = withAuth(
    { roles: ['isSysadmin', 'isBoardMember', 'isKeyholder'] },
    async () => {
        try {
            const members = await prisma.participant.findMany({
                where: { isBoardMember: true },
                select: { id: true, name: true, phone: true, email: true },
                orderBy: { name: "asc" },
            });
            return NextResponse.json({ members });
        } catch (error) {
            await logBackendError(error, "GET /api/safety/board-contacts");
            return NextResponse.json(
                { error: "Internal Server Error fetching board contacts." },
                { status: 500 }
            );
        }
    }
);
