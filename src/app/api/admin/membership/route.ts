import { NextResponse } from "next/server";
import { withAuth } from "@/lib/auth";
import prisma from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/membership — in-flight membership applications for the board.
 * Returns every process not yet ACTIVE, with its household and external-phase
 * flags, so the board can drive the manual steps (contract / BG consent).
 */
export const GET = withAuth({ roles: ["sysadmin", "boardMember"] }, async () => {
    const processes = await prisma.membershipProcess.findMany({
        where: { status: { not: "ACTIVE" } },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            kind: true,
            status: true,
            createdAt: true,
            zohoEnvelopeId: true,
            contractSignedAt: true,
            bgConsentAt: true,
            membership: {
                select: {
                    householdId: true,
                    isVolunteer: true,
                    household: {
                        select: {
                            name: true,
                            participants: { select: { id: true, name: true, email: true } },
                            leads: { select: { participantId: true } },
                        },
                    },
                },
            },
        },
    });

    return NextResponse.json({ processes });
});
