import { NextResponse, type NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/auth";

// Mark an integration error resolved / unresolved.
export const PATCH = withAuth<{ params: Promise<{ id: string }> }>(
    { roles: ["sysadmin", "boardMember"] },
    async (req: NextRequest, _auth, { params }) => {
        const { id } = await params;
        const errorId = parseInt(id, 10);
        if (isNaN(errorId)) {
            return NextResponse.json({ error: "Invalid id" }, { status: 400 });
        }

        try {
            const body = await req.json().catch(() => ({}));
            const resolved = body?.resolved !== false; // default: mark resolved

            const updated = await prisma.integrationError.update({
                where: { id: errorId },
                data: { resolvedAt: resolved ? new Date() : null },
            });

            return NextResponse.json({ error: updated });
        } catch (error) {
            console.error("Failed to update integration error:", error);
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
        }
    }
);
